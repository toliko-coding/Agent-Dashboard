import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

async function mountMetrics(opts: {
  agents?: any[]
  projects?: any[]
  agentsLoading?: boolean
  agentsError?: string | null
  projectsError?: string | null
}) {
  vi.resetModules()
  // Real refs, so the component's template sees the same auto-unwrapping it
  // gets in production — a plain { value } object silently breaks `agents.length`.
  vi.doMock('@/features/agents', async () => {
    const { ref, shallowRef } = await import('vue')
    return {
      useAgents: () => ({
        agents: shallowRef(opts.agents ?? []),
        isLoading: ref(opts.agentsLoading ?? false),
        error: ref(opts.agentsError ?? null),
      }),
    }
  })
  vi.doMock('@/composables/useProjects', async () => {
    const { ref, shallowRef } = await import('vue')
    return {
      useProjects: () => ({
        projects: shallowRef(opts.projects ?? []),
        isLoading: ref(false),
        error: ref(opts.projectsError ?? null),
      }),
    }
  })
  const C = (await import('./OverviewMetrics.vue')).default
  return mount(C)
}

function state(w: any, testid: string) {
  return w.get(`[data-testid="${testid}"]`).attributes('data-state')
}

describe('overviewMetrics', () => {
  it('reports real counts when data is present', async () => {
    const w = await mountMetrics({
      agents: [{ status: 'active' }, { status: 'waiting' }],
      projects: [{ id: 'p' }],
    })
    expect(state(w, 'metric-active-agents')).toBe('ready')
    expect(w.get('[data-testid="metric-active-agents"]').text()).toContain('2')
    expect(w.get('[data-testid="metric-active-agents"]').text()).toContain('1 running')
    expect(state(w, 'metric-projects')).toBe('ready')
  })

  it('uses empty — a real 0 — when the API returned nothing', async () => {
    const w = await mountMetrics({ agents: [], projects: [] })
    expect(state(w, 'metric-active-agents')).toBe('empty')
    expect(state(w, 'metric-projects')).toBe('empty')
  })

  it('marks loading rather than showing 0 before the first response', async () => {
    const w = await mountMetrics({ agents: [], agentsLoading: true })
    expect(state(w, 'metric-active-agents')).toBe('loading')
  })

  it('surfaces an API error as failed, not as empty', async () => {
    const w = await mountMetrics({ agents: [], agentsError: 'boom' })
    expect(state(w, 'metric-active-agents')).toBe('failed')
  })

  // The three capabilities with no collector at all.
  it('renders services, emulators and network as unavailable with no zero', async () => {
    const w = await mountMetrics({ agents: [{ status: 'idle' }], projects: [{ id: 'p' }] })
    for (const id of ['metric-local-services', 'metric-emulators', 'metric-network']) {
      expect(state(w, id)).toBe('notAsked')
      expect(w.get(`[data-testid="${id}"]`).text()).not.toContain('0')
    }
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('LocalScope not connected')
  })

  it('shows no fabricated System Health verdict', async () => {
    const w = await mountMetrics({ agents: [], projects: [] })
    expect(w.text().toLowerCase()).not.toContain('health')
    expect(w.text()).not.toContain('Good')
  })
})
