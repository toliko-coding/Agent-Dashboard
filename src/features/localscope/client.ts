import type { CollectorResult, ProcessSnapshot } from './types'

/*
 * The single place that knows how to reach LocalScope directly.
 *
 * It has exactly one consumer left: the LocalScope page's "show all processes"
 * opt-in. Everything else — the machine snapshot, services, processes and
 * devices — goes through the dashboard's own normalized endpoints, which
 * translate the collector's envelope in the backend so no component ever sees
 * it.
 *
 * `all=true` stays here on purpose rather than moving to a normalized endpoint.
 * It bypasses LocalScope's relevance filter AND its cache, turning one request
 * into an uncached full process scan, so it must remain what it is: an explicit
 * on-demand action, never anything polled.
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
  /** Every process on the machine, relevance filter and cache bypassed. */
  allProcesses: (signal?: AbortSignal) =>
    get<ProcessSnapshot>('/system/processes?all=true', signal),
}
