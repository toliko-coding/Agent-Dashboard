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
 *
 * Both exist only for an agent this dashboard launched (3N.2.1): the server
 * marks it dashboardOwned from its own launch record. A session started in a
 * terminal, VS Code or anything else is observed, never stopped or deleted —
 * the server refuses it too, so hiding the buttons is not the safeguard.
 */

export type LifecycleAction = 'stop' | 'delete' | 'resume'

export interface PendingLifecycle {
  action: LifecycleAction
  agent: Agent
  /** Resume only: the running session is asked to /exit first. */
  endsRunningSession?: boolean
}

const pending = ref<PendingLifecycle | null>(null)

export function useAgentLifecycle() {
  return {
    pending,
    requestStop: (agent: Agent) => { pending.value = { action: 'stop', agent } },
    requestDelete: (agent: Agent) => { pending.value = { action: 'delete', agent } },
    requestResume: (agent: Agent, resume: ResumeAvailability) => { pending.value = { action: 'resume', agent, endsRunningSession: resume.endsRunningSession } },
    cancel: () => { pending.value = null },
  }
}

// Edit agent (3N.2.2): one shared dialog, like the lifecycle confirmation.
const editing = ref<Agent | null>(null)

export function useAgentProfileEditor() {
  return {
    editing,
    requestEdit: (agent: Agent) => { editing.value = agent },
    cancelEdit: () => { editing.value = null },
  }
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null) as { error?: string } | null
  return new Error(body?.error || `${fallback} (${res.status})`)
}

/** Stop and Delete belong only to an agent this dashboard launched. */
export function agentIsDashboardOwned(agent: Agent): boolean {
  return !!agent.dashboardOwned && !agent.machine && !agent.internalProcess && !agent.pipelineTaskId
}

export const EXTERNAL_SESSION_NOTE = 'External session — stop it from the terminal or application that started it.'
export const PIPELINE_AGENT_NOTE = 'Managed by its pipeline task — stop or cancel the task instead.'

export const ENDED_UNMANAGED_NOTE = 'This session has ended. It was not started under Agent Dashboard control, and its conversation is kept.'

/*
 * How an agent's lifecycle reads (3N.2.3), derived only from what the payload
 * already says — dashboardOwned, the process state and the pipeline link:
 *
 *   owned            the dashboard launched it: Stop (while running) and Delete
 *   observed         running, not launched by the dashboard: Observe only
 *   ended-unmanaged  finished and not the dashboard's: there is no process to
 *                    observe any more, only a conversation that can be resumed
 *   pipeline         managed by its pipeline task
 *   none             internal processes and remote sessions, described elsewhere
 *
 * Presentation only: ownership is still decided on the server, per request.
 */
export type LifecycleKind = 'owned' | 'observed' | 'ended-unmanaged' | 'pipeline' | 'none'

export interface LifecyclePresentation {
  kind: LifecycleKind
  badge: string | null
  note: string | null
}

export function lifecyclePresentation(agent: Agent): LifecyclePresentation {
  if (agent.internalProcess || agent.machine)
    return { kind: 'none', badge: null, note: null }
  if (agent.pipelineTaskId)
    return { kind: 'pipeline', badge: 'Pipeline task', note: PIPELINE_AGENT_NOTE }
  if (agentIsDashboardOwned(agent))
    return { kind: 'owned', badge: null, note: null }
  if (!agentIsRunning(agent))
    return { kind: 'ended-unmanaged', badge: 'Not managed', note: ENDED_UNMANAGED_NOTE }
  return { kind: 'observed', badge: 'Observe only', note: EXTERNAL_SESSION_NOTE }
}

/** Why an agent offers no Stop or Delete; null when it does or says so elsewhere. */
export function lifecycleNote(agent: Agent): string | null {
  return lifecyclePresentation(agent).note
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

/**
 * Removes only the name and icon the dashboard stored for a session — its own
 * presentation metadata. The process is untouched, whoever started it.
 */
export async function removeAgentProfile(pid: number): Promise<void> {
  const res = await fetch(`/api/agents/${pid}/profile`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok)
    throw await errorFrom(res, 'Could not remove the name and icon')
}

export interface AgentProfileInput {
  displayName: string
  category: string
}

/** Saves an agent's name and icon — presentation metadata only. Empty clears. */
export async function updateAgentProfile(pid: number, input: AgentProfileInput): Promise<AgentProfileInput> {
  const res = await fetch(`/api/agents/${pid}/profile`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok)
    throw await errorFrom(res, 'Could not save the name and icon')
  return await res.json() as AgentProfileInput
}

/*
 * Resume under Dashboard control (3N.2.2): the only way a session the dashboard
 * did not launch — such as an agent started before ownership was recorded —
 * becomes one it manages. The server resumes the conversation as a new process
 * it launches; a running session is first asked to /exit, and only when this
 * dashboard's own pty broker hosts it. Nothing is signalled.
 */
export interface ResumeAvailability {
  available: boolean
  endsRunningSession: boolean
  reason?: string
}

export interface AgentControl {
  owned: boolean
  managedBy?: string
  resume: ResumeAvailability
}

/** Asked once when the workspace opens or the agent's state changes — never polled. */
export async function getAgentControl(pid: number): Promise<AgentControl> {
  const res = await fetch(`/api/agents/${pid}/control`, { credentials: 'same-origin' })
  if (!res.ok)
    throw await errorFrom(res, 'Could not read what can be done with this agent')
  return await res.json() as AgentControl
}

export interface ResumeResult {
  pid: number
  previousPid: number
  endedRunningSession: boolean
}

export async function resumeUnderDashboard(pid: number): Promise<ResumeResult> {
  const res = await fetch(`/api/agents/${pid}/resume-under-dashboard`, { method: 'POST', credentials: 'same-origin' })
  if (!res.ok)
    throw await errorFrom(res, 'Could not resume the session under Agent Dashboard')
  return await res.json() as ResumeResult
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
