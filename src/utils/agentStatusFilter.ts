import type { Agent } from '../types'

/*
 * Roster status filter.
 *
 * The buckets are named for what a user sees, and each maps onto real server
 * state — no bucket exists that the data cannot fill:
 *
 *   running   agent.working (an open turn / recent pty output), OR status
 *             'active'. Grouping these matches agentDisplayStatus(), which
 *             already renders `working` as its own display status.
 *   waiting   status 'waiting' — the server's 30s–5min quiet window. Labelled
 *             "Quiet" in the UI (see statusLabel) because "waiting" was read as
 *             "waiting for you", which is a different thing.
 *   idle      status 'idle' — beyond the quiet window, process still alive.
 *   completed status 'finished' — the process is gone.
 *
 * There is deliberately no "error" bucket: errorState is a field on an agent
 * that is otherwise still active, not a status value, so it would not partition
 * the roster cleanly.
 */
export type AgentStatusFilter = 'all' | 'running' | 'waiting' | 'idle' | 'completed'

export const AGENT_STATUS_FILTERS: { value: AgentStatusFilter, label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'waiting', label: 'Quiet' },
  { value: 'idle', label: 'Idle' },
  { value: 'completed', label: 'Completed' },
]

export function matchesStatusFilter(agent: Agent, filter: AgentStatusFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'running':
      return agent.working === true || agent.status === 'active'
    case 'waiting':
      return !agent.working && agent.status === 'waiting'
    case 'idle':
      return !agent.working && agent.status === 'idle'
    case 'completed':
      return agent.status === 'finished'
    default:
      return true
  }
}

/** Count per bucket, so a filter chip can show how many it would leave. */
export function statusFilterCounts(agents: Agent[]): Record<AgentStatusFilter, number> {
  return {
    all: agents.length,
    running: agents.filter(a => matchesStatusFilter(a, 'running')).length,
    waiting: agents.filter(a => matchesStatusFilter(a, 'waiting')).length,
    idle: agents.filter(a => matchesStatusFilter(a, 'idle')).length,
    completed: agents.filter(a => matchesStatusFilter(a, 'completed')).length,
  }
}
