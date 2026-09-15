import type { Roadmap, RoadmapPhase } from './roadmapModel'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { axe } from '@/utils/testA11y'
import RoadmapMap from './RoadmapMap.vue'
import { currentPhase, nextPhase, overallLabel, phasePlace, progressLabel, progressPercent } from './roadmapModel'

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
