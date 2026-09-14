import type { WorkspaceRef } from '../types'

/*
 * Where an agent may be started (3M) — the dashboard's own allow-list, apart
 * from any Project. See server/internal/api/agents/working_folders.go.
 *
 * Plain requests on explicit user actions; nothing here polls.
 */

export type FolderCheckReason = 'not-absolute' | 'not-found' | 'not-directory' | 'blacklisted' | 'outside-allowed-folders'

export interface FolderCheck {
  /** Canonical when the folder exists. */
  path: string
  allowed: boolean
  reason?: FolderCheckReason
  /** Allowing the folder would admit it. */
  canAllow: boolean
  /** The resolved checkout, or a plain folder with no repository. Null when not resolved. */
  workspace: WorkspaceRef | null
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}

export async function checkFolder(path: string, signal?: AbortSignal): Promise<FolderCheck> {
  const res = await fetch('/api/agents/spawn/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    signal,
  })
  if (!res.ok)
    throw new Error(await readError(res))
  return res.json() as Promise<FolderCheck>
}

export async function listWorkingFolders(): Promise<string[]> {
  const res = await fetch('/api/agents/working-folders')
  if (!res.ok)
    return []
  const body = await res.json() as { folders?: string[] }
  return body.folders ?? []
}

/** Allows the dashboard to start agents in path. Claude still asks to trust it. */
export async function allowWorkingFolder(path: string): Promise<{ folders: string[], check: FolderCheck }> {
  const res = await fetch('/api/agents/working-folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok)
    throw new Error(await readError(res))
  return res.json() as Promise<{ folders: string[], check: FolderCheck }>
}
