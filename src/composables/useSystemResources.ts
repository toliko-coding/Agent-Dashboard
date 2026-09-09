import { onMounted, onUnmounted, ref } from 'vue'

export interface SystemInfo {
  cpu: { usage: number, cores: number, model: string }
  memory: { total: number, used: number, available: number, usagePercent: number }
  disk: { total: number, used: number, available: number, usagePercent: number, mount: string }
  loadAvg: number[]
  uptime: number
}

/*
 * Shared singleton.
 *
 * This used to allocate fresh refs and its own interval per caller. With one
 * consumer that was invisible; once the status bar, the sidebar machine card,
 * the overview panel and the system map all wanted the same numbers, four
 * independent pollers fetched /api/system on mount within the same tick and
 * tripped the server's per-IP rate limiter (HTTP 429) — so the panels rendered
 * nothing at all.
 *
 * State and the timer are module-level, ref-counted like useSseResource: the
 * first consumer starts polling, the last one to unmount stops it, and every
 * consumer reads the same response.
 */
const DEFAULT_POLL_MS = 15_000

const info = ref<SystemInfo | null>(null)
const error = ref<string | null>(null)

let refCount = 0
let handle: ReturnType<typeof setInterval> | null = null
let inFlight: Promise<void> | null = null

async function fetchSystemInfo(): Promise<void> {
  // Collapse concurrent callers onto one request, so several components
  // mounting together cannot produce a burst.
  if (inFlight)
    return inFlight
  inFlight = (async () => {
    try {
      const res = await fetch('/api/system')
      if (res.ok) {
        info.value = await res.json()
        error.value = null
      }
      else {
        error.value = `Failed to load system info (${res.status})`
      }
    }
    catch {
      error.value = 'Network error loading system info.'
    }
    finally {
      inFlight = null
    }
  })()
  return inFlight
}

function startPolling(intervalMs: number): void {
  if (handle !== null)
    return
  handle = setInterval(() => void fetchSystemInfo(), intervalMs)
}

function stopPolling(): void {
  if (handle !== null) {
    clearInterval(handle)
    handle = null
  }
}

function onVisibilityChange(): void {
  if (document.hidden) {
    stopPolling()
  }
  else if (refCount > 0) {
    void fetchSystemInfo()
    startPolling(DEFAULT_POLL_MS)
  }
}

export function useSystemResources(pollIntervalMs = DEFAULT_POLL_MS) {
  onMounted(() => {
    refCount++
    if (refCount === 1) {
      document.addEventListener('visibilitychange', onVisibilityChange)
      startPolling(pollIntervalMs)
    }
    // Only fetch immediately when nothing has been loaded yet; a later consumer
    // mounting reuses the value already in the shared ref.
    if (info.value === null)
      void fetchSystemInfo()
  })

  onUnmounted(() => {
    refCount--
    if (refCount <= 0) {
      refCount = 0
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  })

  return {
    info,
    error,
    refetch: fetchSystemInfo,
  }
}
