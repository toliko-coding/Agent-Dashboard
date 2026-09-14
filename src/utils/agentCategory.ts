import type { Agent } from '../types'

/*
 * How an agent was launched — a secondary, diagnostic fact (3N.1). The agent's
 * icon is what it is FOR (utils/agentPurpose), chosen by the user; this is
 * shown only as the tooltip on its technical handle.
 *
 * One kind per agent, first match wins, from facts the payload states:
 *
 *   task      runs a pipeline task (pipelineTaskId)
 *   internal  Claude Code's own daemon process, not a session (internalProcess)
 *   desktop   a Claude desktop app session (entrypoint)
 *   terminal  a session whose terminal the dashboard can attach to (liveInjectable)
 *   cli       any other command-line session
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
