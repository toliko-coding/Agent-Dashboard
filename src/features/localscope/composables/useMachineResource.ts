import type { Ref } from 'vue'
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'

/*
 * A shared, ref-counted reader for one normalized machine endpoint.
 *
 * Built as a factory for the same reason the raw LocalScope resources were: a
 * poller per caller multiplies requests by the number of mounted components,
 * which is what tripped the rate limiter and left every panel empty. Each
 * resource here holds module-level state, starts on the first consumer, stops
 * on the last, collapses concurrent callers onto one in-flight request, and
 * pauses entirely while the tab is hidden.
 *
 * These endpoints belong to the dashboard, not to LocalScope, so this knows
 * nothing about the collector's envelope, port, or whether it is running.
 */

export interface MachineResource<T> {
  data: Ref<T>
  /** False until the first response, so "not asked yet" stays distinguishable. */
  loaded: Ref<boolean>
  refetch: () => Promise<void>
}

export function createMachineResource<T>(
  path: string,
  fallback: T,
  pollMs: number,
): () => MachineResource<T> {
  const data = shallowRef<T>(fallback)
  const loaded = ref(false)

  let refCount = 0
  let handle: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null

  async function load(): Promise<void> {
    if (inFlight)
      return inFlight
    inFlight = (async () => {
      try {
        const res = await fetch(path, { credentials: 'same-origin' })
        if (!res.ok) {
          // These endpoints answer 200 with a state even when the collector is
          // absent, so a non-200 is the dashboard itself failing. Keeping the
          // previous value would misreport that as machine data.
          data.value = fallback
          return
        }
        data.value = await res.json() as T
      }
      catch {
        data.value = fallback
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
      handle = setInterval(() => void load(), pollMs)
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

  function reset(): void {
    data.value = fallback
    loaded.value = false
    refCount = 0
    inFlight = null
    stop()
  }

  const use = (): MachineResource<T> => {
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

    return { data, loaded, refetch: load }
  }

  // Test seam: resets the module-level state between cases.
  ;(use as { reset?: () => void }).reset = reset
  return use
}
