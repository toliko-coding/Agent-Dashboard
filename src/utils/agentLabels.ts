import type { Agent } from '../types'
import { shortId } from '../composables/useCopyId'

/*
 * How an agent is named and what it is doing, in one place, for every surface
 * that shows an agent without its details open: Needs you, Command's Active
 * work, and the agent cards. Kept outside the attention and cockpit features so
 * the agents feature can use it without importing either (their barrels import
 * the agents feature back).
 */

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  junie: 'Junie',
}

/**
 * The agent's name: the pipeline task it runs when there is one; otherwise the
 * provider and a short session id. Never the folder name — basename(cwd)
 * collides across checkouts, and the repository and workspace carry identity.
 */
export function agentTitle(agent: Agent): string {
  if (agent.pipelineTaskTitle)
    return agent.pipelineTaskTitle
  // A payload without a session id still gets a name rather than breaking the
  // surface that renders it (the details panel header renders this directly).
  const provider = PROVIDER_LABELS[agent.provider] ?? 'Agent'
  return agent.sessionId ? `${provider} session ${shortId(agent.sessionId)}` : `${provider} session`
}

export type WorkState = 'working' | 'tool'

/**
 * What a working agent is doing, as far as the payload says without exposing
 * anything: an open tool call names its tool — the name only, never its
 * arguments — and otherwise the agent is simply working.
 */
export function workActivity(agent: Agent): { state: WorkState, label: string } {
  const tool = agent.pendingToolUse?.tool
  if (tool && tool !== 'AskUserQuestion')
    return { state: 'tool', label: `Using ${tool}` }
  return { state: 'working', label: 'Working' }
}
