/*
 * Project Intelligence roadmap model (Phase 4B), mirroring server/internal/roadmap
 * by hand (Go cannot be imported; keep the vocabularies in parity).
 *
 * Presentation rules that live here, once:
 *   - A status is shown with a word and a glyph shape, never colour alone.
 *   - Provenance is shown as a quiet marker: User, Suggested, Verified.
 *   - Progress is "7 of 10 items" only when a phase has items; otherwise
 *     there is no percentage.
 *   - "You are here" is the explicit current phase, never inferred.
 */

export const ROADMAP_STATUSES = ['planned', 'ready', 'active', 'blocked', 'completed', 'skipped'] as const
export type RoadmapStatus = typeof ROADMAP_STATUSES[number]

export type RoadmapProvenance = 'user' | 'suggested' | 'verified'

export interface RoadmapTaskRef {
  id: string
  title: string
  stage: string
}

export interface RoadmapItem {
  id: string
  title: string
  status: RoadmapStatus
  provenance: RoadmapProvenance
  blockedReason?: string
  position: number
  task?: RoadmapTaskRef
  updatedAt: string
}

export interface RoadmapProgress {
  completed: number
  total: number
}

export interface RoadmapPhase {
  id: string
  title: string
  description: string
  status: RoadmapStatus
  provenance: RoadmapProvenance
  blockedReason?: string
  decisions?: string
  dependsOn: string[]
  position: number
  current: boolean
  progress: RoadmapProgress | null
  items: RoadmapItem[]
  updatedAt: string
}

export interface RoadmapSummaryCounts {
  phases: number
  completed: number
  active: number
  blocked: number
}

export interface Roadmap {
  projectId: string
  objective: string
  phases: RoadmapPhase[]
  currentPhaseId: string | null
  summary: RoadmapSummaryCounts
  pendingProposals: number
  updatedAt: string
}

export interface ProposedItem {
  title: string
  status: RoadmapStatus
}

export interface ProposedPhase {
  title: string
  description: string
  status: RoadmapStatus
  current: boolean
  evidence: string[] | null
  items: ProposedItem[] | null
}

export interface RoadmapProposal {
  id: string
  status: 'pending' | 'accepted' | 'rejected'
  source: string
  summary: string
  payload: { objective: string, summary: string, phases: ProposedPhase[] }
  createdAt: string
  decidedAt?: string
}

export interface ProjectRoadmapSummary {
  projectId: string
  name: string
  currentPhase: string | null
  currentStatus: RoadmapStatus | null
  summary: RoadmapSummaryCounts
  pendingProposals: number
}

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  planned: 'Planned',
  ready: 'Ready',
  active: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
  skipped: 'Skipped',
}

/** A glyph per status, so status reads without colour. */
export const STATUS_GLYPHS: Record<RoadmapStatus, string> = {
  planned: '○',
  ready: '◌',
  active: '◉',
  blocked: '⚠',
  completed: '✓',
  skipped: '⤼',
}

export const PROVENANCE_LABELS: Record<RoadmapProvenance, string> = {
  user: 'User',
  suggested: 'Suggested',
  verified: 'Verified',
}

export const PROVENANCE_HELP: Record<RoadmapProvenance, string> = {
  user: 'Entered or edited by a person',
  suggested: 'Accepted from an agent proposal and not edited since — not verified',
  verified: 'Read from a linked pipeline task',
}

export function isRoadmapStatus(value: unknown): value is RoadmapStatus {
  return typeof value === 'string' && (ROADMAP_STATUSES as readonly string[]).includes(value)
}

export function currentPhase(roadmap: Roadmap | null): RoadmapPhase | null {
  return roadmap?.phases.find(p => p.current) ?? null
}

/** "7 of 10 items", or null when a phase has nothing to count. */
export function progressLabel(progress: RoadmapProgress | null): string | null {
  if (!progress || progress.total === 0)
    return null
  return `${progress.completed} of ${progress.total} items`
}

export function progressPercent(progress: RoadmapProgress | null): number | null {
  if (!progress || progress.total === 0)
    return null
  return Math.round((progress.completed / progress.total) * 100)
}

/** "3 of 8 phases completed" — counts, not a percentage. Skipped phases do not count. */
export function overallLabel(roadmap: Roadmap): string {
  const counted = roadmap.phases.filter(p => p.status !== 'skipped').length
  const completed = roadmap.phases.filter(p => p.status === 'completed').length
  return `${completed} of ${counted} ${counted === 1 ? 'phase' : 'phases'} completed`
}

/** Where a phase sits relative to the current phase, for the map's layout and motion. */
export type PhasePlace = 'past' | 'current' | 'future'

export function phasePlace(roadmap: Roadmap, phase: RoadmapPhase): PhasePlace {
  const currentIndex = roadmap.phases.findIndex(p => p.current)
  const index = roadmap.phases.findIndex(p => p.id === phase.id)
  if (phase.current)
    return 'current'
  if (currentIndex === -1)
    return phase.status === 'completed' || phase.status === 'skipped' ? 'past' : 'future'
  return index < currentIndex ? 'past' : 'future'
}

/** The next phase after the current one that is not completed or skipped. */
export function nextPhase(roadmap: Roadmap): RoadmapPhase | null {
  const currentIndex = roadmap.phases.findIndex(p => p.current)
  if (currentIndex === -1)
    return null
  return roadmap.phases.slice(currentIndex + 1).find(p => p.status !== 'completed' && p.status !== 'skipped') ?? null
}
