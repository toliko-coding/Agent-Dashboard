import type { Agent } from '../types'

/*
 * What an agent is FOR, as its icon (3N.1). A presentation category the user
 * chooses when starting the agent (Agent.category, saved by session id on the
 * server); nothing infers it — not the folder, the Project, the repository or
 * the prompt. With none chosen, every agent draws the same neutral "general"
 * glyph: deterministic, and saying nothing it does not know.
 *
 * Presentation only. A category never grants, scopes or authorizes anything.
 *
 * How the agent was launched (terminal, desktop, pipeline task…) is a separate,
 * diagnostic fact: utils/agentCategory.
 */
export type AgentPurpose = 'general' | 'development' | 'web' | 'document' | 'research' | 'runtime' | 'data'

export const DEFAULT_AGENT_PURPOSE: AgentPurpose = 'general'

export interface AgentPurposeOption {
  value: AgentPurpose
  /** Short, human wording: the option label and the icon's accessible name. */
  label: string
}

// "General" first: it is the default, and the choice when nothing else fits.
export const AGENT_PURPOSES: readonly AgentPurposeOption[] = [
  { value: 'general', label: 'General' },
  { value: 'development', label: 'Development' },
  { value: 'web', label: 'Web' },
  { value: 'document', label: 'Documents' },
  { value: 'research', label: 'Research' },
  { value: 'runtime', label: 'Runtime & systems' },
  { value: 'data', label: 'Data & trading' },
]

const VALUES = new Set<string>(AGENT_PURPOSES.map(p => p.value))

export function isAgentPurpose(value: unknown): value is AgentPurpose {
  return typeof value === 'string' && VALUES.has(value)
}

export function agentPurpose(agent: Pick<Agent, 'category'>): AgentPurpose {
  return isAgentPurpose(agent.category) ? agent.category : DEFAULT_AGENT_PURPOSE
}

export function agentPurposeLabel(purpose: AgentPurpose): string {
  return AGENT_PURPOSES.find(p => p.value === purpose)?.label ?? 'General'
}

/*
 * One stroke vocabulary on a 24px grid, drawn inline so it follows the theme —
 * the app has no icon package, and these match the rest of its glyphs.
 */
export const AGENT_PURPOSE_PATHS: Readonly<Record<AgentPurpose, readonly string[]>> = {
  general: ['M6.5 8.5h11v9h-11z', 'M12 5v3.5', 'M9.75 12.25h.01', 'M14.25 12.25h.01', 'M9.75 15h4.5'],
  development: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4', 'M13.25 6l-2.5 12'],
  web: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M4 12h16', 'M12 4c2.4 2.2 3.5 5 3.5 8s-1.1 5.8-3.5 8', 'M12 4c-2.4 2.2-3.5 5-3.5 8s1.1 5.8 3.5 8'],
  document: ['M7 4h7l4 4v12H7z', 'M14 4v4h4', 'M9.5 12.5h6', 'M9.5 15.5h6'],
  research: ['M10.5 5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z', 'M14.5 14.5L19 19'],
  runtime: ['M5 5h14v5H5z', 'M5 14h14v5H5z', 'M8 7.5h.01', 'M8 16.5h.01'],
  data: ['M4 19h16', 'M6 15l4-4 3 3 5-6', 'M15 8h3v3'],
}
