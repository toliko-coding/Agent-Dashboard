import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

async function mountMetrics(opts: {
  agents?: any[]
  projects?: any[]
  agentsLoading?: boolean
  agentsError?: string | null
  projectsError?: string | null
  /** LocalScope collector state. undefined = not yet resolved (loading). */
  lsReachable?: boolean
  lsSummary?: any
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
  vi.doMock('@/features/localscope', async () => {
    const { ref, shallowRef } = await import('vue')
    return {
      useLocalScopeSummary: () => ({
        data: shallowRef(opts.lsSummary ?? null),
        error: ref(null),
        reachable: ref(opts.lsReachable ?? null),
        loaded: ref(opts.lsReachable !== undefined),
        refetch: async () => {},
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

  // With the collector down, all three read as unavailable — never as zero.
  it('renders LocalScope metrics as unavailable when the collector is not running', async () => {
    const w = await mountMetrics({
      agents: [{ status: 'idle' }],
      projects: [{ id: 'p' }],
      lsReachable: false,
    })
    for (const id of ['metric-local-services', 'metric-devices', 'metric-network']) {
      expect(state(w, id)).toBe('notAsked')
      expect(w.get(`[data-testid="${id}"]`).text()).not.toContain('0')
    }
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('LocalScope not connected')
  })

  it('shows real LocalScope counts once the collector is reachable', async () => {
    const w = await mountMetrics({
      agents: [{ status: 'idle' }],
      projects: [{ id: 'p' }],
      lsReachable: true,
      lsSummary: {
        services: { running: 4 },
        processes: { relevant: 13, total: 782 },
        devices: { connected: 1 },
        network: { active: null },
        projects: { active: 2 },
      },
    })
    expect(state(w, 'metric-local-services')).toBe('ready')
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('4')
    expect(state(w, 'metric-devices')).toBe('ready')
    expect(w.get('[data-testid="metric-devices"]').text()).toContain('1')
  })

  // LocalScope reports null for a collector it has not built; that must stay
  // unavailable even though LocalScope itself is connected and healthy.
  it('keeps network unavailable when LocalScope reports null for it', async () => {
    const w = await mountMetrics({
      lsReachable: true,
      lsSummary: {
        services: { running: 4 },
        processes: { relevant: 1, total: 2 },
        devices: { connected: 0 },
        network: { active: null },
        projects: { active: 1 },
      },
    })
    expect(state(w, 'metric-network')).toBe('notAsked')
    expect(w.get('[data-testid="metric-network"]').text()).not.toContain('0')
    // A genuine zero from a collector that DID run renders as empty, not unavailable.
    expect(state(w, 'metric-devices')).toBe('empty')
  })

  it('shows no fabricated System Health verdict', async () => {
    const w = await mountMetrics({ agents: [], projects: [] })
    expect(w.text().toLowerCase()).not.toContain('health')
    expect(w.text()).not.toContain('Good')
  })
})
