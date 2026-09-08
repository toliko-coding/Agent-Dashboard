/*
 * LocalScope wire contracts.
 *
 * Hand-mirrored from @localscope/shared (packages/shared/src) rather than
 * imported: LocalScope is a separate repository and pnpm workspace, and this
 * app must build without it present. Keep these in sync by hand — the fields
 * below are the ones the dashboard reads, not necessarily the whole model.
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

/** Trust level for inferred (not observed) fields. `low` must be shown as such. */
export type Confidence = 'high' | 'medium' | 'low'

export type Runtime
  = | 'node' | 'python' | 'java' | 'go' | 'ruby' | 'php' | 'dotnet' | 'unknown'

export type BindScope = 'loopback' | 'all' | 'specific'

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

export interface LocalService {
  id: string
  port: number
  address: string
  bindScope: BindScope
  protocol: 'tcp'
  ipVersion: 'ipv4' | 'ipv6'
  pid: number
  processName: string
  command: string
  cwd: string | null
  runtime: Runtime
  kind: string
  /** Human label for the card title, e.g. 'Vite Development Server'. */
  label: string
  url: string | null
  project: ProjectRef | null
  /** Applies to kind/label/project — NOT to port/pid. */
  confidence: Confidence
  startedAt: string | null
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

export type DevicePlatform = 'android' | 'ios'
export type DeviceForm = 'emulator' | 'simulator' | 'physical'
export type DeviceState = 'online' | 'offline' | 'unauthorized' | 'unavailable'

export interface DevDevice {
  id: string
  serial: string
  platform: DevicePlatform
  form: DeviceForm
  state: DeviceState
  model: string | null
  osVersion: string | null
  details: Record<string, string>
}

/** Counts backing the Overview cards. `null` = not collected, never zero. */
export interface SystemSummary {
  services: { running: number | null }
  processes: { relevant: number | null, total: number | null }
  devices: { connected: number | null }
  network: { active: number | null }
  projects: { active: number | null }
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

export function relevanceLabel(reason: RelevanceReason): string {
  return RELEVANCE_LABELS[reason] ?? reason
}
