import { onUnmounted, ref } from 'vue'

const POLL_INTERVAL_MS = 5 * 60 * 1_000

export interface WindowData {
  key: string
  tokens: number
  costCents: number
  budgetTokens: number | null
  pct: number | null
}

export interface AccountData {
  label: string
  w5h: { tokens: number, costCents: number }
  w7d: { tokens: number, costCents: number }
}

export interface UsageData {
  windows: WindowData[]
  accounts: AccountData[]
}

/*
 * Shared state. App.vue starts the poll for the status bar, and Command's
 * Claude usage panel reads the same response: one request every five minutes
 * however many surfaces show usage. A reader that does not call start() opens
 * nothing; the poll stops when the last caller that started it unmounts.
 */
const data = ref<UsageData | null>(null)
/** Set when the last read failed; the previous reading, if any, stays in `data`. */
const error = ref<string | null>(null)

let intervalId: ReturnType<typeof setInterval> | null = null
let aborter: AbortController | null = null
let starters = 0

async function refresh() {
  aborter?.abort()
  aborter = new AbortController()
  try {
    const res = await fetch('/api/usage', { signal: aborter.signal })
    if (!res.ok) {
      error.value = `Usage could not be read (${res.status})`
      return
    }
    const json = await res.json() as UsageData
    // accounts is omitted from the response for single-account users; guarantee an array.
    data.value = { ...json, accounts: json.accounts ?? [] }
    error.value = null
  }
  catch (e) {
    // An aborted request was superseded, not failed; keep the last known value either way.
    if (!(e instanceof DOMException && e.name === 'AbortError'))
      error.value = 'Usage could not be read'
  }
}

function startPolling() {
  if (intervalId !== null)
    return
  void refresh()
  intervalId = setInterval(refresh, POLL_INTERVAL_MS)
}

function stopPolling() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  aborter?.abort()
  aborter = null
}

export function useUsage() {
  let started = false

  function start() {
    if (started)
      return
    started = true
    starters++
    startPolling()
  }

  function stop() {
    if (!started)
      return
    started = false
    starters = Math.max(0, starters - 1)
    if (starters === 0)
      stopPolling()
  }

  onUnmounted(stop)

  return { data, error, refresh, start, stop }
}
