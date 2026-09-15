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

/*
 * Current vs Suggested (Phase 4.1): how a proposal differs from the roadmap,
 * phase by phase, so accepting never surprises. Phases match by normalized
 * title — the server's roadmap.NormalizeTitle matches the same way, and Add
 * imports only the phases marked 'add'.
 */
export type ProposalChangeKind = 'add' | 'change' | 'remove' | 'unchanged'

export interface ProposalDiffRow {
  kind: ProposalChangeKind
  title: string
  current: RoadmapPhase | null
  proposed: ProposedPhase | null
  /** What differs, in words. Empty unless kind is 'change'. */
  changes: string[]
}

const WHITESPACE = /\s+/

export function normalizeTitle(title: string): string {
  return title.trim().split(WHITESPACE).filter(Boolean).join(' ').toLowerCase()
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function phaseChanges(current: RoadmapPhase, proposed: ProposedPhase): string[] {
  const changes: string[] = []
  if (current.status !== proposed.status)
    changes.push(`Status: ${STATUS_LABELS[current.status]} → ${STATUS_LABELS[proposed.status]}`)
  if (current.current !== proposed.current)
    changes.push(proposed.current ? 'Would become the current phase' : 'Would no longer be the current phase')
  if (proposed.description.trim() && proposed.description.trim() !== current.description.trim())
    changes.push('Description differs')
  const currentItems = new Map(current.items.map(i => [normalizeTitle(i.title), i]))
  const proposedItems = proposed.items ?? []
  const added = proposedItems.filter(i => !currentItems.has(normalizeTitle(i.title))).length
  const proposedTitles = new Set(proposedItems.map(i => normalizeTitle(i.title)))
  const dropped = current.items.filter(i => !proposedTitles.has(normalizeTitle(i.title))).length
  const restatused = proposedItems.filter((i) => {
    const match = currentItems.get(normalizeTitle(i.title))
    return match && match.status !== i.status
  }).length
  if (added)
    changes.push(`${plural(added, 'item')} not on the roadmap`)
  if (dropped)
    changes.push(`${plural(dropped, 'current item')} not in the proposal`)
  if (restatused)
    changes.push(`${plural(restatused, 'item status')} ${restatused === 1 ? 'differs' : 'differ'}`)
  return changes
}

export function proposalDiff(roadmap: Roadmap | null, payload: RoadmapProposal['payload']): ProposalDiffRow[] {
  const existing = new Map((roadmap?.phases ?? []).map(p => [normalizeTitle(p.title), p]))
  const matched = new Set<string>()
  const rows: ProposalDiffRow[] = []
  for (const proposed of payload.phases) {
    const key = normalizeTitle(proposed.title)
    const current = existing.get(key) ?? null
    if (!current || matched.has(key)) {
      rows.push({ kind: 'add', title: proposed.title, current: null, proposed, changes: [] })
      matched.add(key)
      continue
    }
    matched.add(key)
    const changes = phaseChanges(current, proposed)
    rows.push({ kind: changes.length ? 'change' : 'unchanged', title: current.title, current, proposed, changes })
  }
  for (const current of roadmap?.phases ?? []) {
    if (!matched.has(normalizeTitle(current.title)))
      rows.push({ kind: 'remove', title: current.title, current, proposed: null, changes: [] })
  }
  return rows
}

export function diffCounts(rows: ProposalDiffRow[]): Record<ProposalChangeKind, number> {
  const counts: Record<ProposalChangeKind, number> = { add: 0, change: 0, remove: 0, unchanged: 0 }
  for (const row of rows)
    counts[row.kind]++
  return counts
}
