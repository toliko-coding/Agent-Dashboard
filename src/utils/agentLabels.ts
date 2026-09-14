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
 * WHO the agent is — its name, in order:
 *
 *   1. the display name the user gave it when starting it (`agent.displayName`,
 *      saved by session id on the server)
 *   2. the pipeline task it runs
 *   3. the session's own title as Claude Code shows it (the /rename name, else
 *      the title Claude Code generated — `agent.title`)
 *   4. the provider and a short session id
 *
 * Never the folder name, the Project or the repository — basename(cwd) collides
 * across checkouts, and those carry where an agent runs, not who it is.
 */
export function agentTitle(agent: Agent): string {
  const name = agent.displayName?.trim()
  if (name)
    return name
  if (agent.pipelineTaskTitle)
    return agent.pipelineTaskTitle
  const title = agent.title?.trim()
  if (title)
    return title
  return agentSessionLabel(agent)
}

/**
 * The session's stable handle — provider and short session id — which stays
 * the same when a title is generated or renamed. The name of last resort.
 */
export function agentSessionLabel(agent: Agent): string {
  // A payload without a session id still gets a name rather than breaking the
  // surface that renders it (the details panel header renders this directly).
  const provider = PROVIDER_LABELS[agent.provider] ?? 'Agent'
  return agent.sessionId ? `${provider} session ${shortId(agent.sessionId)}` : `${provider} session`
}

/**
 * WHAT the session is about: its Claude Code title, when that title is not
 * already the agent's name. A persistent name says who; the title — generated
 * from the conversation — says what this session is doing, so a named agent
 * shows both and an unnamed one never shows the same words twice.
 */
export function agentTopic(agent: Agent): string | null {
  const title = agent.title?.trim()
  if (!title)
    return null
  return title === agentTitle(agent) ? null : title
}

/**
 * The TECHNICAL handle for a named agent: provider and short session id, e.g.
 * "Claude · 3f2a1b9c". Null when the name already is that handle.
 */
export function agentTechnical(agent: Agent): string | null {
  if (agentTitle(agent) === agentSessionLabel(agent))
    return null
  const provider = PROVIDER_LABELS[agent.provider] ?? 'Agent'
  return agent.sessionId ? `${provider} · ${shortId(agent.sessionId)}` : provider
}

/**
 * What an agent is doing, for surfaces that show every agent (the card and the
 * list row), not only working ones: working names its tool; otherwise the last
 * tool it used, by name. Tool names only — never arguments, which can be a
 * command or a path.
 */
export function agentActivity(agent: Agent): string {
  if (agent.status === 'finished')
    return 'Finished'
  if (agent.working)
    return workActivity(agent).label
  const last = agent.currentAction || agent.lastTools?.at(-1)?.name
  return last ? `Last tool ${last}` : 'No tool used yet'
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
