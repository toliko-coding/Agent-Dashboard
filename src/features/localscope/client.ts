import type { CollectorResult, DevDevice, LocalService, ProcessSnapshot, SystemSummary } from './types'

/*
 * The single place that knows how to reach LocalScope.
 *
 * Everything above this file deals in typed models; nothing else in the
 * dashboard knows the collector's URL shape, its envelope, or that it is a
 * separate process at all. LocalScope owns system collection — this app only
 * consumes it, and must never re-implement ps/lsof/adb parsing.
 *
 * Reachability: the collector binds 127.0.0.1 and answers
 * `Access-Control-Allow-Origin: null`, so the browser cannot call it directly.
 * Requests go to a same-origin `/localscope` prefix which the Vite dev server
 * (and, in production, the Go server) proxies to the collector.
 */

const PREFIX = '/localscope/api'

/** Distinguishes "collector is not running" from "collector answered badly". */
export class LocalScopeUnreachableError extends Error {
  constructor(cause?: unknown) {
    super('LocalScope is not reachable')
    this.name = 'LocalScopeUnreachableError'
    this.cause = cause
  }
}

export class LocalScopeResponseError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`LocalScope responded ${status}`)
    this.name = 'LocalScopeResponseError'
    this.status = status
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<CollectorResult<T>> {
  let res: Response
  try {
    res = await fetch(`${PREFIX}${path}`, { signal, headers: { Accept: 'application/json' } })
  }
  catch (err) {
    // A dead collector shows up as a network error (the proxy refuses the
    // upstream connection). That is an expected state, not a fault.
    throw new LocalScopeUnreachableError(err)
  }

  // The dev proxy answers 502/504 when nothing is listening upstream; treat
  // those as unreachable rather than as a collector-side failure.
  if (res.status === 502 || res.status === 503 || res.status === 504)
    throw new LocalScopeUnreachableError()

  if (!res.ok)
    throw new LocalScopeResponseError(res.status)

  return await res.json() as CollectorResult<T>
}

export const localScopeClient = {
  health: (signal?: AbortSignal) => get<unknown>('/health', signal),
  summary: (signal?: AbortSignal) => get<SystemSummary>('/system/summary', signal),
  /** Listening ports. `all` bypasses LocalScope's relevance filter. */
  services: (all = false, signal?: AbortSignal) =>
    get<LocalService[]>(`/system/ports${all ? '?all=true' : ''}`, signal),
  /** Developer processes. `all` returns every process on the machine. */
  processes: (all = false, signal?: AbortSignal) =>
    get<ProcessSnapshot>(`/system/processes${all ? '?all=true' : ''}`, signal),
  devices: (signal?: AbortSignal) => get<DevDevice[]>('/system/devices', signal),
}
