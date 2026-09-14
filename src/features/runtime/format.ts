/*
 * Small presentation helpers for the Runtime page. Every one of them takes a
 * reported number: a value that was not reported never reaches these, because
 * the caller renders nothing (or "Not collected") for null instead.
 */

const KIB = 1024
const MIB = KIB ** 2
const GIB = KIB ** 3

/** Resident memory, e.g. "96 MB" or "1.4 GB". */
export function bytesLabel(bytes: number): string {
  if (bytes >= GIB)
    return `${(bytes / GIB).toFixed(1)} GB`
  if (bytes >= MIB)
    return `${Math.round(bytes / MIB)} MB`
  return `${Math.max(0, Math.round(bytes / KIB))} KB`
}

/** Capacity, as the host block has always stated it, e.g. "8.0 GiB". */
export function gibLabel(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GiB`
}

/** A running time, e.g. "3d 4h", "2h 5m", "12m", "40s". Non-finite or negative reads "—". */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0)
    return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0)
    return `${d}d ${h}h`
  if (h > 0)
    return `${h}h ${m}m`
  if (m > 0)
    return `${m}m`
  return `${Math.floor(seconds)}s`
}

/** LocalScope's runtime word; its `unknown` means it did not recognise one, which reads badly bare. */
export function runtimeLabel(runtime: string): string {
  return !runtime || runtime === 'unknown' ? 'runtime not identified' : runtime
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
