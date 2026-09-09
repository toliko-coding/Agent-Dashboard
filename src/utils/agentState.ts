import type { Agent } from '../types'
import { STALLED_THRESHOLD_SECONDS } from './format'

/*
 * The one place that decides what an agent is doing.
 *
 * Before this existed, the agent card and the "Waiting for you" band each
 * classified the same Agent object independently: the card said `working ?
 * 'working' : status`, the band ran its own attention rules. A session blocked
 * on a permission prompt therefore rendered as "working" on its card and "No
 * activity" in the band at the same moment — two surfaces contradicting each
 * other about one object. Both now read this.
 *
 * The ordering rule is that POSITIVE EVIDENCE OUTRANKS INFERENCE. A detected
 * dialog is something the session is demonstrably showing; a stalled verdict is
 * only the absence of anything happening for a while. Where both could apply,
 * the observation wins — that mis-ranking is what made a real permission prompt
 * surface, three minutes late, as "No activity".
 */

export type AgentSemanticState
  = | 'permission_required'
    | 'waiting_for_user'
    | 'error'
    | 'stalled'
    | 'working'
    | 'awaiting_input'
    | 'idle'
    | 'finished'

/** Ranked most urgent first. Lower rank sorts earlier in the triage band. */
export const STATE_RANK: Record<AgentSemanticState, number> = {
  waiting_for_user: 0,
  permission_required: 1,
  error: 2,
  stalled: 3,
  awaiting_input: 4,
  idle: 4,
  working: 5,
  finished: 7,
}

export interface AgentStateInfo {
  state: AgentSemanticState
  /** Short human label, shared by every surface so they cannot word it differently. */
  label: string
  tone: 'warning' | 'danger' | 'neutral' | 'info'
  /** True when someone has to act before the session can continue. */
  blocking: boolean
  /**
   * Which signal produced this state, so a surface can explain itself and a
   * test can assert on evidence rather than on a label.
   */
  evidence: 'question' | 'confirm' | 'permission_prompt' | 'held_permission'
    | 'pipeline_permission' | 'terminal_permission' | 'error_state'
    | 'inactivity' | 'turn_open' | 'turn_closed' | 'process_gone' | 'none'
}

const STATE: Record<AgentSemanticState, Omit<AgentStateInfo, 'evidence'>> = {
  permission_required: { state: 'permission_required', label: 'Permission required', tone: 'warning', blocking: true },
  waiting_for_user: { state: 'waiting_for_user', label: 'Question', tone: 'warning', blocking: true },
  error: { state: 'error', label: 'Run failed', tone: 'danger', blocking: true },
  stalled: { state: 'stalled', label: 'No activity', tone: 'warning', blocking: false },
  working: { state: 'working', label: 'Working', tone: 'info', blocking: false },
  awaiting_input: { state: 'awaiting_input', label: 'Your turn', tone: 'neutral', blocking: false },
  idle: { state: 'idle', label: 'Idle', tone: 'neutral', blocking: false },
  finished: { state: 'finished', label: 'Finished', tone: 'neutral', blocking: false },
}

/*
 * Wording that is more specific than the state alone. Two kinds of permission
 * differ in what the reader can DO about them — one is answered in the
 * terminal, the other from the dashboard — and a confirm screen is a different
 * ask from a question, so each keeps its own words.
 */
const LABEL_BY_EVIDENCE: Partial<Record<AgentStateInfo['evidence'], string>> = {
  confirm: 'Confirm answers',
  terminal_permission: 'Answer in terminal',
}

function info(state: AgentSemanticState, evidence: AgentStateInfo['evidence']): AgentStateInfo {
  const base = STATE[state]
  return { ...base, label: LABEL_BY_EVIDENCE[evidence] ?? base.label, evidence }
}

/**
 * Classifies an agent from the evidence its payload actually carries.
 *
 * `secondsSinceActivity` is passed in rather than read from a clock so the
 * result is a pure function of its inputs — every surface computing it from the
 * same tick gets the same answer.
 */
export function agentState(agent: Agent, secondsSinceActivity: number | null): AgentStateInfo {
  // A finished agent's process is gone. Its reconstructed pendingToolUse and
  // errorState are historical, so nothing below them is actionable.
  if (agent.status === 'finished')
    return info('finished', 'process_gone')

  // --- positive evidence, most specific first ---

  // An answerable question outranks a permission prompt: it is about something
  // else entirely and takes a different control.
  if (agent.pendingQuestion)
    return info('waiting_for_user', 'question')
  if (agent.pendingConfirm)
    return info('waiting_for_user', 'confirm')

  // The session is demonstrably showing its own permission dialog, read off the
  // live terminal. This is the signal that used to be missing entirely.
  if (agent.pendingPermissionPrompt)
    return info('permission_required', 'permission_prompt')

  // A PreToolUse hook call the bridge is holding open.
  if (agent.heldPermissions && agent.heldPermissions.length > 0)
    return info('permission_required', 'held_permission')

  // A pipeline stage run's stored request.
  if (agent.pendingPermissions && agent.pendingPermissions.length > 0)
    return info('permission_required', 'pipeline_permission')

  // The bridge saw a prompt open and lapse without a decision.
  if (agent.awaitingTerminalPermission)
    return info('permission_required', 'terminal_permission')

  if (agent.errorState)
    return info('error', 'error_state')

  // --- inference, only once no positive signal applies ---

  /*
   * Two silence-based paths, both weak, both below every positive signal.
   *
   * (a) An unresolved tool_use with nothing happening for a long time. The
   *     transcript renders an awaiting-approval call and a running one
   *     identically, so the honest claim is that nothing has happened in a
   *     while — not which tool, and not that anyone is waiting on it. For a
   *     session whose terminal the dashboard can read, pendingPermissionPrompt
   *     now answers first and this never fires for a real prompt; it remains
   *     the only thing available for a session with no terminal.
   *
   * (b) status === 'active' with the same long silence. This looks
   *     contradictory — merger.CalculateStatus calls an agent active only under
   *     30s — and an earlier read of this code called it dead. It is not: the
   *     status arrives in a payload while the seconds are recomputed locally on
   *     every frame, so a feed that stops delivering leaves a frozen 'active'
   *     beside a clock that keeps going. What it detects is a stale FEED rather
   *     than a stalled agent, and reporting "no activity" is right either way.
   */
  const silent = secondsSinceActivity != null && secondsSinceActivity > STALLED_THRESHOLD_SECONDS
  const toolSilent = silent && Boolean(agent.pendingToolUse) && !agent.permissionsBypassed
  if (toolSilent || (silent && agent.status === 'active'))
    return info('stalled', 'inactivity')

  // Turn finished, process alive: ready for the next instruction rather than
  // blocked on one.
  if (agent.working === false)
    return info(agent.status === 'idle' ? 'idle' : 'awaiting_input', 'turn_closed')

  return info('working', 'turn_open')
}

/**
 * States that put an agent in the triage group.
 *
 * `idle` and `awaiting_input` are both here because both mean "the turn is
 * over, the process is alive" — the distinction between them is how long it has
 * been, which is a display nuance, not a different situation. Keeping both
 * preserves the pre-existing partition used by sortByTriage; the band applies
 * its own narrower filter on top.
 */
const TRIAGE_STATES = new Set<AgentSemanticState>([
  'permission_required',
  'waiting_for_user',
  'error',
  'stalled',
  'awaiting_input',
  'idle',
])

/** True when the agent is a triage candidate. */
export function needsAttention(agent: Agent, secondsSinceActivity: number | null): boolean {
  return TRIAGE_STATES.has(agentState(agent, secondsSinceActivity).state)
}

/**
 * Whether the triage band may offer a standing grant for this agent's pending
 * tool call.
 *
 * Only a signal that names the call qualifies. A detected dialog names the tool
 * on screen but the band cannot answer it remotely, and the notice-based
 * terminal signal outlives its prompt while pendingToolUse is derived
 * separately — the pair drifts, so a rule would be written for a tool nobody
 * asked about.
 */
export function isGrantable(agent: Agent, secondsSinceActivity: number | null): boolean {
  const { evidence } = agentState(agent, secondsSinceActivity)
  if (evidence === 'held_permission' || evidence === 'pipeline_permission')
    return true
  if (evidence === 'terminal_permission') {
    return Boolean(agent.terminalPermissionToolUseId)
      && agent.terminalPermissionToolUseId === agent.pendingToolUse?.id
  }
  return false
}

/** Sorts attention-needing agents first, then longer-waiting first. */
export function sortByTriage(agents: Agent[], secsOf: (a: Agent) => number | null): Agent[] {
  const attention: Agent[] = []
  const rest: Agent[] = []
  for (const agent of agents) {
    if (needsAttention(agent, secsOf(agent)))
      attention.push(agent)
    else
      rest.push(agent)
  }
  attention.sort((a, b) => {
    const ra = STATE_RANK[agentState(a, secsOf(a)).state]
    const rb = STATE_RANK[agentState(b, secsOf(b)).state]
    if (ra !== rb)
      return ra - rb
    return (secsOf(b) ?? 0) - (secsOf(a) ?? 0)
  })
  return [...attention, ...rest]
}
