import type { Ref } from 'vue'
import type { LocalMachineSnapshot } from '../snapshot'
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { EMPTY_SNAPSHOT } from '../snapshot'

/*
 * The normalized machine snapshot, shared by every surface that needs it.
 *
 * Module-level and ref-counted for the same reason the raw LocalScope
 * resources are: several cards mount at once, and a poller per caller was what
 * tripped the server's rate limiter and left every panel empty. One poll feeds
 * them all.
 *
 * This talks to the dashboard's own endpoint, not to the collector. It knows
 * nothing about LocalScope's envelope, its port, or whether it is running.
 */

/*
 * Matches the raw summary poll. The backend normalizer does not cache a
 * successful read, so this cadence is what decides how quickly a stopped
 * collector is noticed — and it sits well inside the 30s window past which a
 * reading is called stale.
 */
const POLL_MS = 5000

const snapshot = shallowRef<LocalMachineSnapshot>(EMPTY_SNAPSHOT)
/** False until the first response, so "not asked yet" is distinguishable. */
const loaded = ref(false)

let refCount = 0
let handle: ReturnType<typeof setInterval> | null = null
let inFlight: Promise<void> | null = null

async function load(): Promise<void> {
  if (inFlight)
    return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/localscope/snapshot', { credentials: 'same-origin' })
      if (!res.ok) {
        // The endpoint answers 200 with a state even when the collector is
        // absent, so a non-200 is the dashboard itself failing. Keeping the
        // previous snapshot would misreport that as machine data.
        snapshot.value = EMPTY_SNAPSHOT
        return
      }
      snapshot.value = await res.json() as LocalMachineSnapshot
    }
    catch {
      // Network failure reaching our own server: same reasoning.
      snapshot.value = EMPTY_SNAPSHOT
    }
    finally {
      loaded.value = true
      inFlight = null
    }
  })()
  return inFlight
}

function start(): void {
  if (handle === null)
    handle = setInterval(() => void load(), POLL_MS)
}

function stop(): void {
  if (handle !== null) {
    clearInterval(handle)
    handle = null
  }
}

function onVisibility(): void {
  if (document.hidden) {
    stop()
  }
  else if (refCount > 0) {
    void load()
    start()
  }
}

export interface LocalMachineResource {
  snapshot: Ref<LocalMachineSnapshot>
  loaded: Ref<boolean>
  refetch: () => Promise<void>
}

export function useLocalMachine(): LocalMachineResource {
  onMounted(() => {
    refCount++
    if (refCount === 1) {
      document.addEventListener('visibilitychange', onVisibility)
      start()
    }
    if (!loaded.value)
      void load()
  })

  onUnmounted(() => {
    refCount--
    if (refCount <= 0) {
      refCount = 0
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })

  return { snapshot, loaded, refetch: load }
}

/** Test seam: resets the module-level state between cases. */
export function __resetLocalMachine(): void {
  snapshot.value = EMPTY_SNAPSHOT
  loaded.value = false
  refCount = 0
  inFlight = null
  stop()
}
