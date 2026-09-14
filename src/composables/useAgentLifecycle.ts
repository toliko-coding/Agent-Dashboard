import type { Agent } from '../types'
import { ref } from 'vue'
import { EDITOR_SCHEMES, editorHref, loadEditorScheme } from '../utils/worktree'

/*
 * Agent lifecycle actions (3N.2): stop, delete, open in the editor, and the
 * projectless workspace endpoints New Agent and Settings use.
 *
 * Stop and delete go through one shared confirmation (AgentLifecycleDialog,
 * mounted once in App.vue): any surface — card, list row, details workspace —
 * asks for it with requestStop/requestDelete, so the wording and the safety
 * rules exist once. Deleting removes the agent from the dashboard; it never
 * deletes its folder, repository or Claude transcript (server/internal/api/
 * agents/lifecycle.go).
 */

export type LifecycleAction = 'stop' | 'delete'

export interface PendingLifecycle {
  action: LifecycleAction
  agent: Agent
}

const pending = ref<PendingLifecycle | null>(null)

export function useAgentLifecycle() {
  return {
    pending,
    requestStop: (agent: Agent) => { pending.value = { action: 'stop', agent } },
    requestDelete: (agent: Agent) => { pending.value = { action: 'delete', agent } },
    cancel: () => { pending.value = null },
  }
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null) as { error?: string } | null
  return new Error(body?.error || `${fallback} (${res.status})`)
}

/** Whether the agent's process is running, as far as the payload says. */
export function agentIsRunning(agent: Agent): boolean {
  return agent.status !== 'finished'
}

export async function stopAgent(pid: number): Promise<void> {
  const res = await fetch(`/api/agents/${pid}/stop`, { method: 'POST', credentials: 'same-origin' })
  if (!res.ok)
    throw await errorFrom(res, 'Could not stop the agent')
}

export interface DeleteResult {
  deleted: boolean
  stopped: boolean
}

/** Deletes the agent from the dashboard; `stop` must be true for a running agent. */
export async function deleteAgent(pid: number, stop: boolean): Promise<DeleteResult> {
  const res = await fetch(`/api/agents/${pid}${stop ? '?stop=true' : ''}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok)
    throw await errorFrom(res, 'Could not delete the agent')
  return await res.json() as DeleteResult
}

/** The editor the user picked for worktrees, or VS Code. */
export function editorLabel(): string {
  const id = loadEditorScheme()
  return EDITOR_SCHEMES.find(s => s.id === id)?.label ?? 'VS Code'
}

/**
 * Opens a working folder in the editor. The path is read from the agent only
 * when the user clicks, so it never sits in a default surface's markup.
 */
export function openInEditor(path: string | null | undefined): boolean {
  const href = editorHref(path, loadEditorScheme())
  if (!href)
    return false
  window.location.assign(href)
  return true
}

export interface ProjectlessRoot {
  root: string
  isDefault: boolean
  exists: boolean
}

export interface ProjectlessWorkspace {
  root: string
  folder: string
  path: string
  exists: boolean
}

export async function getProjectlessRoot(): Promise<ProjectlessRoot> {
  const res = await fetch('/api/agents/projectless')
  if (!res.ok)
    throw await errorFrom(res, 'Could not read the projectless agents folder')
  return await res.json() as ProjectlessRoot
}

export async function setProjectlessRoot(root: string): Promise<ProjectlessRoot> {
  const res = await fetch('/api/agents/projectless', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root }),
  })
  if (!res.ok)
    throw await errorFrom(res, 'Could not save the projectless agents folder')
  return await res.json() as ProjectlessRoot
}

export async function previewProjectlessWorkspace(name: string, signal?: AbortSignal): Promise<ProjectlessWorkspace> {
  const res = await fetch('/api/agents/projectless/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    signal,
  })
  if (!res.ok)
    throw await errorFrom(res, 'Could not name a workspace folder')
  return await res.json() as ProjectlessWorkspace
}

export async function createProjectlessWorkspace(name: string): Promise<ProjectlessWorkspace> {
  const res = await fetch('/api/agents/projectless/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok)
    throw await errorFrom(res, 'Could not create the workspace folder')
  return await res.json() as ProjectlessWorkspace
}
