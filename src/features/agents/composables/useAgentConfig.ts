import type { AgentConfigDTO } from '@/sdk.generated'

/*
 * An agent's saved configuration, read and written one agent at a time.
 *
 * Deliberately not part of the agent stream. Standing instructions run to
 * thousands of characters and the roster is broadcast every few seconds, so the
 * stream carries only whether an agent has any (`hasSavedInstructions`) and the
 * saved mode; the text itself is fetched when something actually shows it — the
 * Edit dialog, or the confirmation shown before a resume.
 *
 * What comes back describes two different things and keeps them apart:
 * `permissionMode` is saved for the NEXT session, `sessionPermissionMode` is
 * what the process running right now was started with. Claude reads its mode
 * once, at startup, so saving never changes a running session and the UI must
 * not imply it does.
 */

export type AgentConfigPatch = Partial<Pick<
  AgentConfigDTO,
  'displayName' | 'category' | 'instructions' | 'permissionMode'
>>

async function readError(res: Response, fallback: string): Promise<Error> {
  try {
    const body = await res.json() as { error?: string }
    return new Error(body.error || fallback)
  }
  catch {
    return new Error(fallback)
  }
}

export async function fetchAgentConfig(pid: number): Promise<AgentConfigDTO> {
  const res = await fetch(`/api/agents/${pid}/config`, { credentials: 'same-origin' })
  if (!res.ok)
    throw await readError(res, 'Could not read this agent’s configuration')
  return await res.json() as AgentConfigDTO
}

/**
 * Saves part of an agent's configuration. Only the fields present are written,
 * so saving a name cannot silently clear instructions.
 */
export async function saveAgentConfig(pid: number, patch: AgentConfigPatch): Promise<AgentConfigDTO> {
  const res = await fetch(`/api/agents/${pid}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  })
  if (!res.ok)
    throw await readError(res, 'Could not save this agent’s configuration')
  return await res.json() as AgentConfigDTO
}

/**
 * Whether a saved mode and the running session's mode disagree in a way worth
 * telling the user about. Mirrors the server's own rule: nothing saved is not a
 * disagreement, and neither is a session whose command line was never observed.
 */
export function configDiffersFromSession(config: AgentConfigDTO | null): boolean {
  return !!config?.differsFromSession
}
