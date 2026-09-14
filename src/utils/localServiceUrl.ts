/*
 * The browser address of a local development service LocalScope observed
 * (3N.2.2): always `http://localhost:<port>` (or https when LocalScope
 * classified the loopback service as HTTPS), built only from a validated port.
 *
 * - Never from a raw service string: the address LocalScope reports is where
 *   the socket is bound (`*`, `0.0.0.0`, `::`, `127.0.0.1`, `::1`), not where a
 *   browser should go, and `url` is only consulted for its scheme.
 * - Only TCP listeners reachable on loopback — bound to loopback or to all
 *   interfaces. A listener bound to one specific non-loopback address is not
 *   reachable at localhost, so it gets no link.
 * - Not every TCP port speaks HTTP. The link opens what is there; a database or
 *   inspector socket simply fails to load in the browser.
 */

export const MIN_PORT = 1
export const MAX_PORT = 65535

export interface LocalServiceEndpoint {
  port: unknown
  protocol?: string | null
  bindScope?: string | null
  address?: string | null
  url?: string | null
}

/** Addresses that mean "this machine" or "every interface on it". */
const LOCAL_BIND_ADDRESSES = new Set(['*', '0.0.0.0', '::', '[::]', '127.0.0.1', '::1', '[::1]', 'localhost'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT
}

function reachableOnLoopback(s: LocalServiceEndpoint): boolean {
  if (s.bindScope === 'loopback' || s.bindScope === 'all')
    return true
  // No scope reported: fall back to the bind address, and only a local one.
  return !s.bindScope && typeof s.address === 'string' && LOCAL_BIND_ADDRESSES.has(s.address.trim().toLowerCase())
}

/** HTTPS only when LocalScope's own URL for the service says so, on loopback. */
function scheme(url: string | null | undefined): 'http' | 'https' {
  if (!url)
    return 'http'
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && LOOPBACK_HOSTS.has(parsed.hostname) ? 'https' : 'http'
  }
  catch {
    return 'http'
  }
}

/** The localhost address for the service, or null when it gets no link. */
export function localServiceUrl(s: LocalServiceEndpoint): string | null {
  if (!isValidPort(s.port))
    return null
  if ((s.protocol ?? 'tcp').toLowerCase() !== 'tcp')
    return null
  if (!reachableOnLoopback(s))
    return null
  return `${scheme(s.url)}://localhost:${s.port}`
}
