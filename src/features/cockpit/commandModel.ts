import type { AttentionItem } from '@/features/attention'
import type { Agent } from '@/types'

/*
 * What the Command page derives from the agents it already receives. Pure, so
 * every rule here is testable without mounting anything.
 */

/** Agents that are sessions the user can see work in: not finished, not Claude Code's own daemons. */
export function liveAgents(agents: Agent[]): Agent[] {
  return agents.filter(a => a.status !== 'finished' && !a.internalProcess)
}

/**
 * Active work: agents executing right now.
 *
 * `working` is the server's open-turn / recent-output signal. An agent that is
 * also a canonical attention item is excluded: an open turn blocked on a
 * question or a permission is waiting on the user, not working, and it is
 * already shown — once — in Needs you.
 */
export function activeWorkAgents(agents: Agent[], attentionItems: AttentionItem[]): Agent[] {
  const waitingOnUser = new Set(attentionItems.flatMap(item => item.subject.type === 'agent' ? [item.subject.sessionId] : []))
  return liveAgents(agents).filter(a => a.working && !waitingOnUser.has(a.sessionId))
}

export interface AgentFootprint {
  /** Distinct RepositoryRef ids among the agents. */
  repositories: number
  /** Distinct WorkspaceRef ids among the agents. */
  workspaces: number
  /** Agents whose workspace could not be resolved — counted, never guessed. */
  unresolved: number
}

/** Where agents are, by identity only: two repositories that share a name are two. */
export function agentFootprint(agents: Agent[]): AgentFootprint {
  const repositories = new Set<string>()
  const workspaces = new Set<string>()
  let unresolved = 0
  for (const agent of agents) {
    const ws = agent.workspace
    if (!ws?.id) {
      unresolved++
      continue
    }
    workspaces.add(ws.id)
    if (ws.repository?.id)
      repositories.add(ws.repository.id)
  }
  return { repositories: repositories.size, workspaces: workspaces.size, unresolved }
}

export type WorkState = 'working' | 'tool'

/**
 * What a working agent is doing, as far as the payload says without exposing
 * anything: a tool call that is open right now names its tool — the name only,
 * never its arguments — and otherwise the agent is simply working.
 */
export function workActivity(agent: Agent): { state: WorkState, label: string } {
  const tool = agent.pendingToolUse?.tool
  if (tool && tool !== 'AskUserQuestion')
    return { state: 'tool', label: `Using ${tool}` }
  return { state: 'working', label: 'Working' }
}
