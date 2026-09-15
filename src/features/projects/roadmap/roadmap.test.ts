import type { Roadmap, RoadmapPhase, RoadmapProposal } from './roadmapModel'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { axe } from '@/utils/testA11y'
import RoadmapMap from './RoadmapMap.vue'
import { currentPhase, diffCounts, nextPhase, normalizeTitle, overallLabel, phasePlace, progressLabel, progressPercent, proposalDiff } from './roadmapModel'
import RoadmapProposals from './RoadmapProposals.vue'

// Phase 4B: the roadmap model and mission map — position, provenance, honest progress.

const agentsRef = ref<any[]>([])
vi.mock('@/features/agents', () => ({ useAgents: () => ({ agents: agentsRef }) }))

function phase(o: Partial<RoadmapPhase>): RoadmapPhase {
  return {
    id: o.title ?? 'p',
    title: 'Phase',
    description: '',
    status: 'planned',
    provenance: 'user',
    dependsOn: [],
    position: 0,
    current: false,
    progress: null,
    items: [],
    updatedAt: '2026-09-15T10:00:00Z',
    ...o,
  }
}

function roadmap(phases: RoadmapPhase[]): Roadmap {
  const current = phases.find(p => p.current)
  return {
    projectId: 'proj',
    objective: 'Monitor and orchestrate local agents',
    phases,
    currentPhaseId: current?.id ?? null,
    summary: { phases: phases.length, completed: phases.filter(p => p.status === 'completed').length, active: 0, blocked: phases.filter(p => p.status === 'blocked').length },
    pendingProposals: 0,
    updatedAt: '2026-09-15T10:00:00Z',
  }
}

const AD = roadmap([
  phase({ id: 'a', title: 'Communication reliability', status: 'completed' }),
  phase({ id: 'b', title: 'LocalScope integration', status: 'completed', provenance: 'suggested' }),
  phase({ id: 'c', title: 'Project Intelligence', status: 'active', current: true, progress: { completed: 3, total: 7 } }),
  phase({ id: 'd', title: 'Orchestration', status: 'planned' }),
  phase({ id: 'e', title: 'Security Intelligence', status: 'blocked', blockedReason: 'needs orchestration' }),
])

describe('roadmapModel', () => {
  it('states progress only when there are items, as counts', () => {
    expect(progressLabel({ completed: 7, total: 10 })).toBe('7 of 10 items')
    expect(progressPercent({ completed: 7, total: 10 })).toBe(70)
    expect(progressLabel(null)).toBeNull()
    expect(progressLabel({ completed: 0, total: 0 })).toBeNull()
    expect(progressPercent(null)).toBeNull()
  })

  it('counts phases, not a percentage, and ignores skipped phases', () => {
    expect(overallLabel(AD)).toBe('2 of 5 phases completed')
    expect(overallLabel(roadmap([phase({ status: 'completed' }), phase({ id: 'x', status: 'skipped' })]))).toBe('1 of 1 phase completed')
  })

  it('places phases around the explicit current phase and finds what is next', () => {
    expect(currentPhase(AD)?.title).toBe('Project Intelligence')
    expect(AD.phases.map(p => phasePlace(AD, p))).toEqual(['past', 'past', 'current', 'future', 'future'])
    expect(nextPhase(AD)?.title).toBe('Orchestration')
    const noCurrent = roadmap([phase({ id: 'x', status: 'completed' }), phase({ id: 'y', status: 'planned' })])
    expect(currentPhase(noCurrent)).toBeNull()
    expect(nextPhase(noCurrent)).toBeNull()
    expect(noCurrent.phases.map(p => phasePlace(noCurrent, p))).toEqual(['past', 'future'])
  })
})

describe('roadmapMap', () => {
  const mountMap = (props: Record<string, unknown> = {}) => mount(RoadmapMap, { props: { roadmap: AD, selectedId: null, ...props }, attachTo: document.body })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('makes the current phase unmistakable: You are here, aria-current, a slow pulse', () => {
    const w = mountMap()
    const current = w.get('[data-testid="roadmap-phase-c"]')
    expect(current.attributes('data-place')).toBe('current')
    expect(current.get('[data-testid="roadmap-you-are-here"]').text()).toBe('You are here')
    expect(current.get('button').attributes('aria-current')).toBe('step')
    expect(current.find('[data-testid="roadmap-current-pulse"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="roadmap-you-are-here"]')).toHaveLength(1)
    expect(w.findAll('[aria-current="step"]')).toHaveLength(1)
  })

  it('shows status as a word and a glyph, and provenance as a quiet marker', () => {
    const w = mountMap()
    const rows = w.findAll('[data-testid^="roadmap-phase-"][data-place]')
    expect(rows.map(r => r.get('[data-testid="roadmap-phase-status"]').text())).toEqual(['Completed', 'Completed', 'Active', 'Planned', 'Blocked'])
    expect(rows[0].text()).toContain('✓')
    expect(rows[4].text()).toContain('⚠')
    expect(rows[4].text()).toContain('needs orchestration')
    expect(rows.map(r => r.get('[data-testid="roadmap-phase-provenance"]').text())).toEqual(['User', 'Suggested', 'User', 'User', 'User'])
  })

  it('shows item progress only where there are items', () => {
    const w = mountMap()
    expect(w.get('[data-testid="roadmap-phase-c"]').get('[data-testid="roadmap-phase-progress"]').text()).toContain('3 of 7 items')
    expect(w.get('[data-testid="roadmap-phase-d"]').find('[data-testid="roadmap-phase-progress"]').exists()).toBe(false)
  })

  it('flows toward the current phase only while an agent works here, and pulses amber only when one needs you', () => {
    expect(mountMap().find('[data-flowing="true"]').exists()).toBe(false)
    const working = mountMap({ working: true })
    const flow = working.findAll('[data-flowing="true"]')
    expect(flow).toHaveLength(1)
    expect(working.get('[data-testid="roadmap-phase-b"]').find('[data-flowing="true"]').exists()).toBe(true)
    expect(mountMap({ needsYou: true }).find('[data-testid="roadmap-needs-you"]').exists()).toBe(true)
  })

  it('selects a phase from the keyboard-reachable button', async () => {
    const w = mountMap()
    await w.get('[data-testid="roadmap-phase-open-d"]').trigger('click')
    expect(w.emitted('select')).toEqual([['d']])
  })

  it('has no axe violations', async () => {
    const w = mountMap({ working: true, selectedId: 'c' })
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })
})

describe('projectIntelligenceView', () => {
  let calls: { method: string, url: string, body: any }[]
  let current: Roadmap
  const project = { id: 'proj', slug: 'agent-dashboard', name: 'Agent Dashboard', folders: [{ id: 'f', projectId: 'proj', path: '/Users/me/Agent-Dashboard', isDefault: true, createdAt: '' }], createdAt: '', updatedAt: '' }

  beforeEach(() => {
    calls = []
    current = roadmap([
      phase({ id: 'a', title: 'Command Center UI', status: 'completed' }),
      phase({ id: 'c', title: 'Project Intelligence', status: 'active', current: true }),
    ])
    agentsRef.value = [
      { pid: 1, sessionId: 's1', cwd: '/Users/me/Agent-Dashboard', working: true, status: 'active', dashboardOwned: true, title: 'Builder' },
      { pid: 2, sessionId: 's2', cwd: '/Users/me/Elsewhere', working: true, status: 'active', title: 'Other project' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method: init?.method ?? 'GET', url, body })
      if (url.endsWith('/proposals'))
        return { ok: true, json: async () => [] }
      if (init?.method === 'POST' && url.endsWith('/phases'))
        current = roadmap([...current.phases, phase({ id: 'n', title: body.title })])
      return { ok: true, json: async () => current }
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  async function mountView() {
    const { default: View } = await import('./ProjectIntelligenceView.vue')
    const w = mount(View, { props: { project }, attachTo: document.body })
    await flushPromises()
    return w
  }

  it('answers where the project is: objective, you are here, next and agents working here', async () => {
    const w = await mountView()
    expect(w.get('#project-intelligence-title').text()).toBe('Agent Dashboard')
    expect(w.get('[data-testid="project-objective"]').text()).toBe('Monitor and orchestrate local agents')
    expect(w.get('[data-testid="project-current-phase"]').text()).toContain('Project Intelligence')
    expect(w.get('[data-testid="project-overall"]').text()).toBe('1 of 2 phases completed')
    expect(w.get('[data-testid="project-position"]').text()).toContain('1 working · 1 running')
    expect(w.get('[data-testid="roadmap-detail"]').text()).toContain('Project Intelligence')
    expect(calls.map(c => c.url)).toEqual(expect.arrayContaining(['/api/projects/proj/roadmap', '/api/projects/proj/roadmap/proposals']))
  })

  it('adds a phase through the API and never sends provenance', async () => {
    const w = await mountView()
    await w.get('[data-testid="roadmap-new-phase"]').setValue('Orchestration')
    await w.get('[data-testid="roadmap-add-phase"]').trigger('click')
    await flushPromises()
    const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/phases'))!
    expect(post.body).toEqual({ title: 'Orchestration', status: 'planned', description: '' })
    expect(post.body).not.toHaveProperty('provenance')
    expect(w.text()).toContain('Orchestration')
  })

  it('has no axe violations', async () => {
    const w = await mountView()
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })
})

// Phase 4.1: Current vs Suggested — what accepting a proposal would change.
const NOW = roadmap([
  phase({ id: 'r1', title: 'Communication reliability', status: 'completed', items: [{ id: 'i1', title: 'Channel', status: 'completed', provenance: 'user', position: 0, updatedAt: '' }] }),
  phase({ id: 'r2', title: 'Project Intelligence', status: 'active', current: true }),
  phase({ id: 'r3', title: 'Smarter Command Center', status: 'planned' }),
])
const PROPOSAL: RoadmapProposal = {
  id: 'prop-1',
  status: 'pending',
  source: 'agent',
  summary: 'Moves current to Orchestration.',
  createdAt: '2026-09-15T11:20:00Z',
  payload: {
    objective: 'One command center for local agents',
    summary: '',
    phases: [
      { title: '  communication   RELIABILITY ', description: '', status: 'completed', current: false, evidence: ['git log: #115'], items: [{ title: 'channel', status: 'completed' }] },
      { title: 'Project Intelligence', description: '', status: 'active', current: false, evidence: null, items: [{ title: 'Review the first proposal', status: 'active' }] },
      { title: 'Orchestration', description: 'Run tasks', status: 'active', current: true, evidence: ['ADR-0014'], items: null },
    ],
  },
}

describe('proposalDiff', () => {
  it('matches phases by normalized title and names every difference in words', () => {
    expect(normalizeTitle('  communication   RELIABILITY ')).toBe('communication reliability')
    const rows = proposalDiff(NOW, PROPOSAL.payload)
    expect(rows.map(r => [r.kind, r.title])).toEqual([
      ['unchanged', 'Communication reliability'],
      ['change', 'Project Intelligence'],
      ['add', 'Orchestration'],
      ['remove', 'Smarter Command Center'],
    ])
    expect(rows[1].changes).toEqual(['Would no longer be the current phase', '1 item not on the roadmap'])
    expect(diffCounts(rows)).toEqual({ add: 1, change: 1, remove: 1, unchanged: 1 })
  })

  it('treats every phase as new when there is no roadmap', () => {
    expect(proposalDiff(null, PROPOSAL.payload).every(r => r.kind === 'add')).toBe(true)
  })
})

describe('roadmapProposals', () => {
  const mountReview = (props: Record<string, unknown> = {}) => mount(RoadmapProposals, {
    props: { proposals: [PROPOSAL], roadmap: NOW, agents: [], busy: false, ...props },
    attachTo: document.body,
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows Current vs Suggested with New, Changed, Not in proposal and Unchanged — never raw JSON', () => {
    const w = mountReview()
    expect(w.text()).toContain('Current vs Suggested')
    expect(w.get('[data-testid="roadmap-diff-counts"]').findAll('span').map(c => c.text())).toEqual(['+ 1 new', '~ 1 changed', '− 1 not in proposal', '= 1 unchanged'])
    expect(w.findAll('[data-testid="roadmap-diff-row"]').map(r => r.attributes('data-kind'))).toEqual(['unchanged', 'change', 'add', 'remove'])
    expect(w.text()).toContain('kept by Add, deleted by Replace')
    const items = w.findAll('[data-testid="roadmap-diff-items"]')
    expect(items[1].text().replace(/\s+/g, ' ')).toContain('Review the first proposal — Active · not on the roadmap')
    expect(w.text()).not.toContain('{"')
    expect(w.get('[data-testid="roadmap-proposal-explain"]').text()).toContain('imports only the 1 phase marked New')
  })

  it('adds only the new phases, and replaces only after saying what is deleted', async () => {
    const w = mountReview()
    const add = w.get('[data-testid="roadmap-accept-prop-1"]')
    expect(add.text()).toBe('Add 1 phase')
    await add.trigger('click')
    expect(w.emitted('accept')).toEqual([['prop-1', 'append']])
    expect(w.find('[data-testid="roadmap-replace-prop-1"]').exists()).toBe(false)
    await w.get('[data-testid="roadmap-replace-start-prop-1"]').trigger('click')
    expect(w.get('[data-testid="roadmap-replace-warning"]').text()).toContain('Deletes all 3 phases')
    await w.get('[data-testid="roadmap-replace-prop-1"]').trigger('click')
    expect(w.emitted('accept')?.[1]).toEqual(['prop-1', 'replace'])
    await w.get('[data-testid="roadmap-reject-prop-1"]').trigger('click')
    expect(w.emitted('reject')).toEqual([['prop-1']])
  })

  it('disables Add when the proposal has nothing new', () => {
    const onlyKnown = { ...PROPOSAL, payload: { ...PROPOSAL.payload, phases: PROPOSAL.payload.phases.slice(0, 2) } }
    const w = mountReview({ proposals: [onlyKnown] })
    expect(w.get('[data-testid="roadmap-accept-prop-1"]').attributes('disabled')).toBeDefined()
  })

  it('has no axe violations', async () => {
    const w = mountReview()
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })
})

describe('projectIntelligenceView freshness', () => {
  let gets: string[]
  let now: number
  const project = { id: 'proj', slug: 'p', name: 'P', folders: [], createdAt: '', updatedAt: '' }
  beforeEach(() => {
    gets = []
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET')
        gets.push(url)
      return { ok: true, json: async () => (url.endsWith('/proposals') ? [] : NOW) }
    }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'visibilityState')
    document.body.innerHTML = ''
  })

  it('refetches when the window regains focus, at most every 5 s, and never on a timer', async () => {
    const { default: View } = await import('./ProjectIntelligenceView.vue')
    const w = mount(View, { props: { project }, attachTo: document.body })
    await flushPromises()
    const roadmapGets = () => gets.filter(u => u.endsWith('/roadmap')).length
    expect(roadmapGets()).toBe(1)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(roadmapGets()).toBe(1)
    now += 6_000
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(roadmapGets()).toBe(2)
    expect(gets.filter(u => u.endsWith('/proposals'))).toHaveLength(2)
    w.unmount()
    now += 6_000
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(roadmapGets()).toBe(2)
  })
})
