import type { MainAgentDTO } from '@/sdk.generated'
import { computed, onMounted, ref } from 'vue'

/*
 * The main agent's durable record: the agent that maintains Agent Dashboard.
 *
 * Separate from useMainAgent, which is the pure question "is this agent the
 * main one" asked of a roster entry. This is the record itself — the one that
 * exists whether or not any session is running it, which is what lets the
 * Agents view show the main agent when it has no process at all.
 *
 * There is no way to create or promote one from here. The record is seeded on
 * the server with a fixed id, so the only thing this can change is which
 * session is running it, and that grants the session nothing: ownership still
 * decides Stop, Delete and terminal attach, and an external session stays
 * observe-only with a label on it.
 *
 * Whether the linked session is alive is deliberately not part of the record.
 * The roster already answers that, and a liveness flag written into a stored
 * record would be wrong the moment the process exited.
 */

const record = ref<MainAgentDTO | null>(null)
let loaded = false
let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  if (loaded)
    return
  if (inFlight)
    return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/main-agent', { credentials: 'same-origin' })
      // 404 is a real answer: this server has seeded no main agent.
      record.value = res.ok ? await res.json() as MainAgentDTO : null
    }
    catch {
      record.value = null
    }
    finally {
      loaded = true
      inFlight = null
    }
  })()
  return inFlight
}

/** Records which running session is the main agent, or clears it with pid 0. */
export async function linkMainAgentSession(pid: number): Promise<MainAgentDTO> {
  const res = await fetch('/api/main-agent/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ pid }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error || `Could not link that session (${res.status})`)
  }
  record.value = await res.json() as MainAgentDTO
  loaded = true
  return record.value
}

export function useMainAgentRecord() {
  onMounted(() => {
    void load()
  })
  return {
    mainAgent: computed(() => record.value),
    /** The session id running the main agent, or "" when none is linked. */
    mainSessionId: computed(() => record.value?.sessionId ?? ''),
    refresh: async () => {
      loaded = false
      await load()
    },
  }
}

/** Test seam: drops the cached record. */
export function resetMainAgentRecordForTest(): void {
  record.value = null
  loaded = false
  inFlight = null
}
