/*
 * LocalScope wire contracts.
 *
 * Hand-mirrored from @localscope/shared (packages/shared/src) rather than
 * imported: LocalScope is a separate repository and pnpm workspace, and this
 * app must build without it present.
 *
 * What remains here is only what the one surviving direct consumer needs — the
 * `all=true` process opt-in in client.ts. Everything else the dashboard shows
 * is normalized in the Go backend and typed in snapshot.ts, so the collector's
 * envelope no longer reaches a component. Types for endpoints that moved were
 * deleted with their pollers rather than kept as an unused mirror to drift.
 *
 * The load-bearing convention, which LocalScope states explicitly in its own
 * summary.ts: a count of `null` means NOT COLLECTED, never zero. Zero
 * emulators connected and adb not being installed are different facts.
 */

export type DegradedKind = 'missing' | 'unavailable' | 'timeout' | 'partial' | 'failed'

export interface DegradedSource {
  source: string
  reason: string
  kind: DegradedKind
}

/** Standard envelope for every LocalScope /api read. */
export interface CollectorResult<T> {
  data: T
  degraded: DegradedSource[]
  collectedAt: string
  durationMs: number
}

export type Runtime
  = | 'node' | 'python' | 'java' | 'go' | 'ruby' | 'php' | 'dotnet' | 'unknown'

export interface ProjectRef {
  id: string
  name: string
  packageName: string | null
  rootPath: string
  displayPath: string
  manifest: string | null
  git: { isRepo: boolean, branch: string | null }
  frameworks: string[]
}

export type RelevanceReason
  = | 'runtime-match' | 'tool-match' | 'listening' | 'in-project' | 'container'

export interface DevProcess {
  id: string
  pid: number
  ppid: number
  name: string
  command: string
  cwd: string | null
  runtime: Runtime
  cpuPercent: number | null
  memoryBytes: number | null
  elapsedSeconds: number | null
  startedAt: string | null
  project: ProjectRef | null
  ports: number[]
  relevant: boolean
  relevanceReasons: RelevanceReason[]
}

export interface ProcessSnapshot {
  processes: DevProcess[]
  /** Every process on the machine, including filtered-out ones. */
  total: number
}

/**
 * Human wording for LocalScope's internal relevance codes. The dashboard shows
 * the sentence, never the code — the point of the reasons is to make the
 * filtering explainable.
 */
export const RELEVANCE_LABELS: Record<RelevanceReason, string> = {
  'runtime-match': 'Known development runtime',
  'tool-match': 'Known development tool',
  'listening': 'Listening service',
  'in-project': 'Running inside project',
  'container': 'Container process',
}

/*
 * Takes a plain string, not the RelevanceReason union: the normalized process
 * model carries reasons as strings, because a reason LocalScope adds later must
 * still render — as itself — rather than failing to type-check or vanishing.
 */
export function relevanceLabel(reason: string): string {
  return RELEVANCE_LABELS[reason as RelevanceReason] ?? reason
}
