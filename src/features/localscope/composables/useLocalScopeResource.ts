import type { Ref } from 'vue'
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { LocalScopeUnreachableError } from '../client'

/*
 * A shared, ref-counted LocalScope resource.
 *
 * Built deliberately as a factory rather than one composable per endpoint,
 * because Phase 4 shipped a bug worth not repeating: useSystemResources
 * allocated a fresh poller per caller, four components mounted at once, and
 * the burst tripped the server's rate limiter so every panel rendered empty.
 *
 * Each resource here holds module-level state, starts polling on the first
 * consumer, stops on the last, collapses concurrent callers onto one in-flight
 * request, and pauses entirely while the tab is hidden. LocalScope also caches
 * for ~2s server-side, so a shared 5s poll is comfortably inside its budget.
 */

/** Reachability is a property of the collector, so it is shared across resources. */
const reachable = ref<boolean | null>(null)

export interface LocalScopeResource<T> {
  data: Ref<T | null>
  /** Non-null only for a real collector-side failure, not for "not running". */
  error: Ref<string | null>
  /** null until the first attempt resolves. */
  reachable: Ref<boolean | null>
  loaded: Ref<boolean>
  refetch: () => Promise<void>
}

export function createLocalScopeResource<T>(
  fetcher: (signal?: AbortSignal) => Promise<{ data: T }>,
  pollMs = 5000,
): () => LocalScopeResource<T> {
  const data = shallowRef<T | null>(null)
  const error = ref<string | null>(null)
  const loaded = ref(false)

  let refCount = 0
  let handle: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null

  async function load(): Promise<void> {
    if (inFlight)
      return inFlight
    inFlight = (async () => {
      try {
        const result = await fetcher()
        data.value = result.data
        error.value = null
        reachable.value = true
      }
      catch (err) {
        if (err instanceof LocalScopeUnreachableError) {
          // Not an error state: the collector is optional and simply absent.
          reachable.value = false
          error.value = null
        }
        else {
          reachable.value = true
          error.value = err instanceof Error ? err.message : 'LocalScope request failed'
        }
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

  return function useResource(): LocalScopeResource<T> {
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

    return { data, error, reachable, loaded, refetch: load }
  }
}

/** Shared reachability signal, for components that only need connected-or-not. */
export function useLocalScopeReachable(): Ref<boolean | null> {
  return reachable
}
