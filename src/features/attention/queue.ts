import type { PermissionItem } from '@/composables/usePendingPermissions'
import type { PendingCapabilityDecision } from '@/sdk.generated'
import type { Agent, PendingPermission, PipelineTask, RepositoryRef, WorkspaceRef } from '@/types'
import { agentTitle } from '@/utils/agentLabels'
import { attentionFor } from '@/utils/attention'
import { formatErrorState } from '@/utils/format'
import { STAGE_LABELS } from '@/utils/stageLabels'

/*
 * The canonical attention queue: what needs the user right now.
 *
 * One derivation, from data the dashboard already receives — the agents
 * stream (agents and capability decisions), the tasks stream, and the pending
 * permission requests App.vue already fetches for blocked tasks. No request,
 * stream or timer belongs to it, and nothing about machine connectivity or
 * LocalScope feeds it: an unavailable collector is not something the user has
 * to act on.
 *
 * Levels, and what is allowed to produce each:
 *
 *   blocking  work cannot continue until the user acts. An AskUserQuestion
 *             modal or its submit screen on the live terminal; a permission
 *             call the bridge is holding; a pipeline stage run's stored
 *             permission requests; the session's own permission prompt
 *             (typed Notification hook); an unanswered AskUserQuestion in a
 *             session whose screen cannot be read (it completes only when a
 *             person answers); a capability decision waiting at a server
 *             enforcement point; a task parked on lingering requests.
 *   failed    an explicit failure: an API error the parser classified
 *             (rate limited, quota exhausted, authentication failed) on a
 *             session that is not working. errorState is never cleared by a
 *             later success, so a session that is working again is not
 *             reported — its error is history. That is the only guard the
 *             payload allows: an idle session that recovered and then finished
 *             its turn still carries the old error while it stays in the
 *             transcript tail, so the item is worded as what the log reported
 *             ("API error reported: …"), never as the session's current state.
 *   stalled   no producer. The two client stall heuristics could not tell a
 *             stuck session from normal work: an unresolved tool_use past 3
 *             minutes is also a long build, and "active but silent" compared
 *             the server's status bucket with the browser's clock, which read
 *             every agent as stalled once the stream dropped. Both are retired;
 *             the level stays for evidence the server may one day supply.
 *   ready     the workflow has handed a turn to the user: a pipeline task
 *             whose latest stage run is awaiting_user (plan or artifact
 *             approval, an escalation) and that no other item already covers.
 *
 * Not attention: an agent that is working, or idle, or has simply finished its
 * turn. "Your turn" is the resting state of every interactive session, and
 * counting it made every idle agent look like a request.
 */

// Re-exported: the name lives in utils/agentLabels, shared with Active work and the agent cards.
export { agentTitle }

export const ATTENTION_LEVELS = ['blocking', 'failed', 'stalled', 'ready'] as const
export type AttentionLevel = typeof ATTENTION_LEVELS[number]

export type AttentionKind
  = | 'question'
    | 'confirm'
    | 'permission'
    | 'terminal-permission'
    | 'capability'
    | 'task-permissions'
    | 'api-error'
    | 'task-waiting'

/** What an item is about, and so where selecting it leads. */
export type AttentionSubject
  = | { type: 'agent', sessionId: string }
    | { type: 'task', taskId: string }
    | { type: 'capability', decisionId: string }

export interface AttentionItem {
  /** Stable per subject: `agent:<sessionId>`, `task:<taskId>`, `capability:<id>`. */
  id: string
  level: AttentionLevel
  kind: AttentionKind
  subject: AttentionSubject
  /** The agent the item belongs to, when it belongs to one. */
  agentSessionId: string | null
  /** Resolved identity only. Null is "not resolved", never "no workspace". */
  workspace: WorkspaceRef | null
  repository: RepositoryRef | null
  /** Who: the agent, task or requester. */
  title: string
  /** Why, in the user's words. */
  reason: string
  /** A safe qualifier — a tool or capability name, a stage, a count. Never a path, command or transcript text. */
  detail?: string
  /** When the wait began, only from a timestamp the request itself carries. */
  since: string | null
  /** The subject's last recorded activity — a different fact from `since`, labelled as such. */
  lastActivity: string | null
}

export interface AttentionSources {
  agents: Agent[]
  permissionItems: PermissionItem[]
  capabilityDecisions: PendingCapabilityDecision[]
  tasks: PipelineTask[]
}

const LEVEL_RANK: Record<AttentionLevel, number> = { blocking: 0, failed: 1, stalled: 2, ready: 3 }

function validIso(value: string | null | undefined): string | null {
  return value && !Number.isNaN(Date.parse(value)) ? value : null
}

/** The earliest valid timestamp, or null — never a fabricated one. */
function oldest(values: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const value of values) {
    const iso = validIso(value)
    if (iso && (best === null || Date.parse(iso) < Date.parse(best)))
      best = iso
  }
  return best
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function permissionDetail(requests: PendingPermission[]): string {
  const tools = [...new Set(requests.map(r => r.tool))]
  const named = tools.length === 1 ? tools[0] : plural(tools.length, 'tool', 'tools')
  return requests.length > 1 ? `${named} · ${plural(requests.length, 'request', 'requests')}` : named
}

function agentItem(agent: Agent): AttentionItem | null {
  // attentionFor has no clock, so stale data can never manufacture attention.
  const att = attentionFor(agent)
  if (!att)
    return null

  const base = {
    id: `agent:${agent.sessionId}`,
    subject: { type: 'agent', sessionId: agent.sessionId } as const,
    agentSessionId: agent.sessionId,
    workspace: agent.workspace ?? null,
    repository: agent.workspace?.repository ?? null,
    title: agentTitle(agent),
    lastActivity: validIso(agent.lastActivity),
  }

  switch (att.kind) {
    case 'question':
      // attentionFor ranks a question above its submit screen; the TUI shows one or the other.
      if (agent.pendingQuestion)
        return { ...base, level: 'blocking', kind: 'question', reason: 'Question waiting for your answer', since: null }
      if (agent.pendingConfirm)
        return { ...base, level: 'blocking', kind: 'confirm', reason: 'Answers waiting to be submitted', since: null }
      return { ...base, level: 'blocking', kind: 'question', reason: 'Question waiting in its terminal', since: null }
    case 'permission': {
      // Same precedence as attentionFor: held call, stored requests, terminal prompt.
      const held = agent.heldPermissions ?? []
      if (held.length > 0)
        return { ...base, level: 'blocking', kind: 'permission', reason: 'Permission request waiting', detail: permissionDetail(held), since: oldest(held.map(p => p.requestedAt)) }
      const stored = agent.pendingPermissions ?? []
      if (stored.length > 0)
        return { ...base, level: 'blocking', kind: 'permission', reason: 'Permission request waiting', detail: permissionDetail(stored), since: oldest(stored.map(p => p.requestedAt)) }
      return { ...base, level: 'blocking', kind: 'terminal-permission', reason: 'Permission prompt open in its terminal', since: null }
    }
    case 'error':
      if (agent.working || !agent.errorState)
        return null
      return { ...base, level: 'failed', kind: 'api-error', reason: `API error reported: ${formatErrorState(agent.errorState)}`, detail: 'in the session\'s recent log', since: null }
    default:
      return null
  }
}

/**
 * Deduplication, per subject:
 *
 *  - One item per agent. A session is stopped on one thing at a time, and
 *    attentionFor already names the one that stops it; the held call, its
 *    lapsed terminal prompt and its stored request are the same prompt.
 *  - A task parked on permission requests folds into its agent's permission
 *    item when that agent is blocked on permissions — the same requests seen
 *    from the task. Anything else about that task stays its own item.
 *  - A task awaiting the user is dropped when a permission item for it exists,
 *    or its agent is already blocking: that stage run is waiting on exactly
 *    that condition.
 *  - Capability decisions belong to no session and are always their own items.
 */
export function buildAttentionQueue(sources: AttentionSources): AttentionItem[] {
  const items: AttentionItem[] = []
  const blockingByTask = new Map<string, AttentionItem>()

  for (const agent of sources.agents) {
    const item = agentItem(agent)
    if (!item)
      continue
    items.push(item)
    if (agent.pipelineTaskId && item.level === 'blocking')
      blockingByTask.set(agent.pipelineTaskId, item)
  }

  const permissionTaskIds = new Set<string>()
  for (const entry of sources.permissionItems) {
    permissionTaskIds.add(entry.taskId)
    const since = oldest(entry.requests.map(r => r.requestedAt))
    const agentItemForTask = blockingByTask.get(entry.taskId)
    if (agentItemForTask && (agentItemForTask.kind === 'permission' || agentItemForTask.kind === 'terminal-permission')) {
      agentItemForTask.since = oldest([agentItemForTask.since, since])
      continue
    }
    items.push({
      id: `task:${entry.taskId}`,
      level: 'blocking',
      kind: 'task-permissions',
      subject: { type: 'task', taskId: entry.taskId },
      agentSessionId: null,
      workspace: null,
      repository: null,
      title: entry.title,
      reason: 'Permission requests holding a pipeline task',
      detail: plural(entry.requests.length, 'request', 'requests'),
      since,
      lastActivity: null,
    })
  }

  for (const task of sources.tasks) {
    if (!task.needsUser || permissionTaskIds.has(task.id) || blockingByTask.has(task.id))
      continue
    items.push({
      id: `task:${task.id}`,
      level: 'ready',
      kind: 'task-waiting',
      subject: { type: 'task', taskId: task.id },
      agentSessionId: null,
      workspace: null,
      repository: null,
      title: task.title,
      reason: 'Pipeline task waiting for you',
      detail: STAGE_LABELS[task.currentStage] ?? undefined,
      since: null,
      lastActivity: null,
    })
  }

  for (const decision of sources.capabilityDecisions) {
    items.push({
      id: `capability:${decision.id}`,
      level: 'blocking',
      kind: 'capability',
      subject: { type: 'capability', decisionId: decision.id },
      agentSessionId: null,
      workspace: null,
      repository: null,
      title: 'Capability check',
      reason: 'Waiting for your decision',
      detail: decision.capability,
      since: validIso(decision.requestedAt),
      lastActivity: null,
    })
  }

  return items.sort(compareAttention)
}

/**
 * Level first. Within a level, items with a real request timestamp lead,
 * oldest first; the rest follow in id order, so the list never reshuffles
 * between identical frames.
 */
export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  if (a.level !== b.level)
    return LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
  if (a.since && b.since)
    return Date.parse(a.since) - Date.parse(b.since) || a.id.localeCompare(b.id)
  if (a.since !== b.since)
    return a.since ? -1 : 1
  return a.id.localeCompare(b.id)
}

export type AttentionStatus = 'loading' | 'unavailable' | 'ready'

export interface AttentionQueue {
  /**
   * loading      no agent observation yet — the queue is unknown, not empty.
   * unavailable  the first agent read failed and nothing was ever observed.
   * ready        derived from at least one real observation.
   */
  status: AttentionStatus
  /** Ready, but agent updates are not currently arriving: items are last known. */
  stale: boolean
  items: AttentionItem[]
}

export interface AttentionQueueInputs {
  items: AttentionItem[]
  agentsObserved: boolean
  agentsError: string | null
  tasksLoading: boolean
  live: boolean
}

export function attentionQueueState(inputs: AttentionQueueInputs): AttentionQueue {
  if (!inputs.agentsObserved)
    return { status: inputs.agentsError ? 'unavailable' : 'loading', stale: false, items: [] }
  // Tasks feed ready items and permission items; until they have loaded, an
  // empty queue would be a claim nobody has checked.
  if (inputs.tasksLoading)
    return { status: 'loading', stale: false, items: [] }
  return { status: 'ready', stale: !inputs.live, items: inputs.items }
}
