import type { Agent } from '../types'

/*
 * What kind of worker an agent is, from facts the payload states — never from
 * its folder, and never decoration. This replaced a per-folder random emoji
 * (useAgentIdentity), which looked like a category but meant nothing: two
 * agents in one folder shared it, and it said nothing about either of them.
 *
 * One category per agent, first match wins:
 *
 *   task      runs a pipeline task (pipelineTaskId)
 *   internal  Claude Code's own daemon process, not a session (internalProcess)
 *   desktop   a Claude desktop app session (entrypoint)
 *   terminal  a session whose terminal the dashboard can attach to (liveInjectable)
 *   cli       any other command-line session
 *
 * The category is structure, not state: it never takes a state colour and
 * never moves. State stays on the state indicator beside the name.
 */
export type AgentCategory = 'task' | 'internal' | 'desktop' | 'terminal' | 'cli'

export interface AgentKind {
  category: AgentCategory
  /** Short, human wording for tooltips and assistive technology. */
  label: string
}

const LABELS: Record<AgentCategory, string> = {
  task: 'Pipeline task agent',
  internal: 'Claude Code internal process',
  desktop: 'Desktop app session',
  terminal: 'Terminal session',
  cli: 'Command-line session',
}

export function agentCategory(agent: Pick<Agent, 'pipelineTaskId' | 'internalProcess' | 'entrypoint' | 'liveInjectable'>): AgentCategory {
  if (agent.pipelineTaskId)
    return 'task'
  if (agent.internalProcess)
    return 'internal'
  if (agent.entrypoint === 'desktop')
    return 'desktop'
  if (agent.liveInjectable)
    return 'terminal'
  return 'cli'
}

export function agentKind(agent: Pick<Agent, 'pipelineTaskId' | 'internalProcess' | 'entrypoint' | 'liveInjectable'>): AgentKind {
  const category = agentCategory(agent)
  return { category, label: LABELS[category] }
}

export const AGENT_CATEGORY_LABELS: Readonly<Record<AgentCategory, string>> = LABELS
