import type { Agent } from '@/types'
import { computed, onMounted, ref } from 'vue'

/*
 * The main agent: the one that maintains Agent Dashboard itself.
 *
 * It is an explicit designation, stored as a single setting
 * (agents.mainSessionId) holding one Claude session id. One key means there is
 * at most one main agent by construction, rather than by a rule someone has to
 * remember. Nothing is inferred: an agent working in the Agent Dashboard
 * repository is not the main agent, because "works here" is not a designation
 * and would name several agents at once.
 *
 * It grants nothing. Main status carries no permission, bypasses no ownership
 * check, and gives no authority over other agents - it changes how an agent is
 * shown and nothing else. That is why it can live in a setting and be read by
 * the client: there is no decision on the server that depends on it.
 *
 * The badge additionally requires the agent to be one the dashboard started.
 * A session id outlives the session it named, and an id that is stale, or was
 * typed in by hand, must never decorate a Terminal or VS Code session as the
 * dashboard's own maintainer.
 */

const SETTING_KEY = 'agents.mainSessionId'

/** Is this the designated main agent? The rule, with no I/O, so it can be tested directly. */
export function isMainAgent(agent: Pick<Agent, 'sessionId' | 'dashboardOwned'> | null, mainSessionId: string): boolean {
  if (!agent || !mainSessionId || !agent.sessionId)
    return false
  return agent.sessionId === mainSessionId && agent.dashboardOwned === true
}

const mainSessionId = ref('')
let loaded = false
let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  // Every agent card mounts this; the designation is one value for the page, so
  // it is fetched once rather than once per card.
  if (loaded)
    return
  if (inFlight)
    return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/settings', { credentials: 'same-origin' })
      if (!res.ok)
        return
      const items = await res.json() as Array<{ key: string, value: string }>
      mainSessionId.value = items.find(i => i.key === SETTING_KEY)?.value ?? ''
    }
    catch {
      // Unknown stays unknown: no designation is shown rather than a wrong one.
    }
    finally {
      loaded = true
      inFlight = null
    }
  })()
  return inFlight
}

/** Designates an agent as main, or clears the designation with an empty id. */
export async function setMainAgent(sessionId: string): Promise<void> {
  const res = await fetch(`/api/settings/${SETTING_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ value: sessionId }),
  })
  if (!res.ok)
    throw new Error(`HTTP ${res.status}`)
  mainSessionId.value = sessionId
  loaded = true
}

export function useMainAgent() {
  onMounted(() => {
    void load()
  })
  return {
    mainSessionId: computed(() => mainSessionId.value),
    isMain: (agent: Agent | null) => isMainAgent(agent, mainSessionId.value),
    refresh: load,
  }
}

/** Test seam: clears the cached designation. */
export function resetMainAgentForTest(): void {
  mainSessionId.value = ''
  loaded = false
  inFlight = null
}
