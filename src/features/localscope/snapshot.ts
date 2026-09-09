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

/*
 * Normalized lists.
 *
 * Same freshness vocabulary as the snapshot, deliberately: a surface that shows
 * counts and one that shows rows must not need two different ideas of what
 * "stale" means.
 */

/** Shared by every normalized LocalScope response. */
export interface Freshness {
  source: SnapshotSource
  collectedAt: string | null
  ageMs: number | null
  degraded: LocalMachineDegradation[]
}

/**
 * A project LocalScope inferred from a working directory.
 *
 * Named apart from a project the user registered here: they answer different
 * questions and disagree on monorepos. Nothing may treat this as a dashboard
 * project id until the two are reconciled.
 */
export interface DiscoveredProject {
  id: string
  name: string
  /** The manifest's own name, often unrelated to the folder. */
  packageName: string | null
  rootPath: string
  /** rootPath with $HOME collapsed to ~. */
  displayPath: string
  manifest: string | null
  git: { isRepo: boolean, branch: string | null }
  /** The enclosing repository when the root is not itself the repo root. */
  repo: { name: string, rootPath: string } | null
  frameworks: string[]
}

/** A listening port, in developer terms. */
export interface MachineService {
  id: string
  pid: number
  port: number
  address: string
  protocol: string
  bindScope: string
  ipVersion: string
  processName: string
  /** LocalScope's sanitized argv, passed through — never rebuilt here. */
  command: string
  cwd: string | null
  runtime: string
  kind: string
  label: string
  url: string | null
  discoveredProject: DiscoveredProject | null
  /** Qualifies kind, label and discoveredProject — never port or pid. */
  confidence: string
  startedAt: string | null
}

/** A development process LocalScope considered relevant. */
export interface MachineProcess {
  id: string
  pid: number
  ppid: number
  name: string
  command: string
  cwd: string | null
  runtime: string
  /** Null when ps did not report it — not 0. */
  cpuPercent: number | null
  memoryBytes: number | null
  elapsedSeconds: number | null
  startedAt: string | null
  ports: number[]
  relevanceReasons: string[]
  discoveredProject: DiscoveredProject | null
}

/**
 * `items` is null when the list is not known and `[]` when the collector looked
 * and found none. Collapsing the two would report an unreachable collector as a
 * machine with nothing running on it.
 */
export interface MachineServices extends Freshness {
  items: MachineService[] | null
}

export interface MachineProcesses extends Freshness {
  items: MachineProcess[] | null
  /** Every process on the machine, so a filtered list can say "38 of 818". */
  total: number | null
}

export const EMPTY_SERVICES: MachineServices = {
  source: 'unavailable',
  collectedAt: null,
  ageMs: null,
  degraded: [],
  items: null,
}

export const EMPTY_PROCESSES: MachineProcesses = {
  source: 'unavailable',
  collectedAt: null,
  ageMs: null,
  degraded: [],
  items: null,
  total: null,
}

/** True when the reading carries a list that was observed at some point. */
export function hasItems(r: { items: unknown[] | null }): boolean {
  return r.items !== null
}
