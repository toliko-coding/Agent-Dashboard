/*
 * The dashboard's own view of the local machine.
 *
 * Deliberately NOT LocalScope's `CollectorResult<SystemSummary>`. A component
 * reading this never learns that the collector exists as a separate process,
 * what its envelope looks like, or which of its endpoints supplied a field —
 * so a change on that side lands in the backend normalizer and nowhere else.
 *
 * Hand-mirrored from server/internal/api/localscope/snapshot.go, the same
 * arrangement the rest of this feature uses: tygo covers the SSE agent payload
 * only, so these two must be kept in parity by hand.
 */

/** How much the reported counts can be trusted. */
export type SnapshotSource
  /** Collected just now, every contributing source healthy. */
  = | 'ok'
    /** Collected just now, but at least one source reported a problem. */
    | 'degraded'
    /** True at collectedAt, not known to be true now. */
    | 'stale'
    /** Nothing usable. No counts, and none are invented. */
    | 'unavailable'

/** One collector that could not run, in its own words. */
export interface LocalMachineDegradation {
  source: string
  reason: string
  /** LocalScope's classification: missing, unavailable, timeout, partial, failed. */
  kind: string
}

/*
 * Every count is `number | null`, and the null is load-bearing.
 *
 * `0` means the collector measured that category and found none. `null` means
 * it did not measure it — no Android SDK, no adb server. Rendering both as "0"
 * would report "no emulators connected" for a machine that was never asked.
 */
export interface LocalMachineCounts {
  services: number | null
  processesRelevant: number | null
  processesTotal: number | null
  devices: number | null
  network: number | null
  projects: number | null
}

export interface LocalMachineSnapshot {
  source: SnapshotSource
  /** When the counts were true, from the collector's clock. Null if never collected. */
  collectedAt: string | null
  /** How old those counts are. Null alongside collectedAt. */
  ageMs: number | null
  /** Never null; empty means every source succeeded. */
  degraded: LocalMachineDegradation[]
  counts: LocalMachineCounts
}

/**
 * The snapshot to show before the first response arrives.
 *
 * Unavailable rather than an empty machine: not having asked yet is much closer
 * to "unknown" than to "nothing is running".
 */
export const EMPTY_SNAPSHOT: LocalMachineSnapshot = {
  source: 'unavailable',
  collectedAt: null,
  ageMs: null,
  degraded: [],
  counts: {
    services: null,
    processesRelevant: null,
    processesTotal: null,
    devices: null,
    network: null,
    projects: null,
  },
}

/** True when the snapshot carries counts that were true at some point. */
export function hasReading(snapshot: LocalMachineSnapshot): boolean {
  return snapshot.source !== 'unavailable'
}

/** Human age for a stale reading, e.g. "3m ago". Null when there is no reading. */
export function formatAge(ageMs: number | null): string | null {
  if (ageMs == null)
    return null
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60)
    return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}
