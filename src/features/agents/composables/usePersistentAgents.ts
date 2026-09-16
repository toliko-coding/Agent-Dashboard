import type { DashboardAgentConfigDTO, DashboardAgentDTO } from '@/sdk.generated'
import type { Agent } from '@/types'
import { computed, onMounted, ref } from 'vue'

/*
 * The agents this dashboard keeps, as opposed to the processes running now.
 *
 * The roster is built from live processes plus an in-process registry of
 * recently-finished ones, so restarting the server emptied the Agents page of
 * every finished agent — Resume Editor and Portfolio Developer among them —
 * although nothing had been deleted. This list is read from storage, so an
 * agent stays until someone deletes it.
 *
 * It deliberately carries no liveness. Whether a session is running is a fact
 * about the roster, which the caller already has, so `withoutLiveSession()`
 * answers that by matching session ids rather than trusting a stored flag.
 */

const agents = ref<DashboardAgentDTO[]>([])
const loaded = ref(false)
let inFlight: Promise<void> | null = null

async function load(force = false): Promise<void> {
  if (loaded.value && !force)
    return
  if (inFlight)
    return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/dashboard-agents', { credentials: 'same-origin' })
      if (res.ok)
        agents.value = await res.json() as DashboardAgentDTO[]
    }
    catch {
      // Unknown stays unknown: the section renders nothing rather than claiming
      // this dashboard keeps no agents.
    }
    finally {
      loaded.value = true
      inFlight = null
    }
  })()
  return inFlight
}

/** One agent in full: the folder, the Project, the saved instructions and mode. */
export async function fetchPersistentAgentConfig(agentId: string): Promise<DashboardAgentConfigDTO> {
  const res = await fetch(`/api/dashboard-agents/${agentId}/config`, { credentials: 'same-origin' })
  if (!res.ok)
    throw new Error(`Could not read that agent (${res.status})`)
  return await res.json() as DashboardAgentConfigDTO
}

/** Saves what the agent's NEXT session starts with. Nothing running changes. */
export async function savePersistentAgentConfig(agentId: string, patch: {
  displayName?: string
  category?: string
  instructions?: string
  permissionMode?: string
}): Promise<DashboardAgentConfigDTO> {
  const res = await fetch(`/api/dashboard-agents/${agentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `Could not save that agent (${res.status})`)
  }
  const saved = await res.json() as DashboardAgentConfigDTO
  agents.value = agents.value.map(a => a.agentId === agentId
    ? { ...a, displayName: saved.displayName, category: saved.category, permissionMode: saved.permissionMode, hasInstructions: !!saved.instructions }
    : a)
  return saved
}

/*
 * Starts a session for an agent that has none.
 *
 * `agentId` is what keeps this one agent: the server points the existing record
 * at the new session instead of creating a second agent with the same name and
 * folder. `resumeSessionId` is sent only when the agent's last transcript is
 * still on disk, so a continued conversation is never promised for a session
 * Claude can no longer open.
 */
export async function startPersistentAgent(cfg: DashboardAgentConfigDTO, prompt: string): Promise<{ pid: number }> {
  const body: Record<string, unknown> = {
    prompt,
    cwd: cfg.cwd,
    agentId: cfg.agentId,
    enableChannel: true,
  }
  if (cfg.resumable && cfg.sessionId)
    body.resumeSessionId = cfg.sessionId
  if (cfg.permissionMode)
    body.permissionMode = cfg.permissionMode
  if (cfg.instructions)
    body.systemPrompt = cfg.instructions
  if (cfg.projectId)
    body.projectId = cfg.projectId
  const res = await fetch('/api/agents/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const failed = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(failed?.error || `Could not start that agent (${res.status})`)
  }
  await load(true)
  return await res.json() as { pid: number }
}

/** Removes the dashboard's record of an agent. Files and history are untouched. */
export async function deletePersistentAgent(agentId: string): Promise<void> {
  const res = await fetch(`/api/dashboard-agents/${agentId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `Could not delete that agent (${res.status})`)
  }
  agents.value = agents.value.filter(a => a.agentId !== agentId)
}

/**
 * The durable agents with no session in the roster: the ones that would
 * otherwise have disappeared. The main agent is excluded — it has its own panel.
 */
export function withoutLiveSession(stored: DashboardAgentDTO[], roster: Agent[]): DashboardAgentDTO[] {
  const running = new Set(roster.map(a => a.sessionId).filter(Boolean))
  return stored.filter(a => a.role !== 'main' && !(a.sessionId && running.has(a.sessionId)))
}

export function usePersistentAgents() {
  onMounted(() => {
    void load()
  })
  return {
    persistentAgents: computed(() => agents.value),
    loaded: computed(() => loaded.value),
    refresh: () => load(true),
  }
}

/** Test seam: drops the cached list. */
export function resetPersistentAgentsForTest(): void {
  agents.value = []
  loaded.value = false
  inFlight = null
}
