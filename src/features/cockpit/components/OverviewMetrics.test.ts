import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

async function mountMetrics(opts: {
  agents?: any[]
  projects?: any[]
  agentsLoading?: boolean
  agentsError?: string | null
  projectsError?: string | null
  /** Normalized snapshot. undefined = first response not yet in (loading). */
  snapshot?: any
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
  /*
   * The row now consumes the dashboard's own snapshot, so the mock is that
   * shape. Nothing here mentions CollectorResult, which is the point of the
   * migration: the Overview no longer knows LocalScope's envelope exists.
   */
  vi.doMock('@/features/localscope', async () => {
    const { ref, shallowRef } = await import('vue')
    // Pure helpers come from the real module: mocking them would test the
    // mock's idea of "stale · 3m ago" rather than the app's.
    const { EMPTY_SNAPSHOT, formatAge, freshnessNote } = await import('@/features/localscope/snapshot')
    // The real indicator, not a stub: the whole point of the machine-scope line
    // is WHAT it renders, so a stub would assert the mock's wording.
    const DataFreshnessIndicator
      = (await import('@/features/localscope/components/DataFreshnessIndicator.vue')).default
    return {
      DataFreshnessIndicator,
      formatAge,
      freshnessNote,
      useLocalMachine: () => ({
        snapshot: shallowRef(opts.snapshot ?? EMPTY_SNAPSHOT),
        loaded: ref(opts.snapshot !== undefined),
        refetch: async () => {},
      }),
    }
  })
  const C = (await import('./OverviewMetrics.vue')).default
  return mount(C)
}

/** Builds a normalized snapshot, defaulting every count to unknown. */
function snap(over: {
  source?: string
  ageMs?: number | null
  degraded?: any[]
  counts?: Partial<Record<string, number | null>>
} = {}) {
  return {
    source: over.source ?? 'ok',
    collectedAt: '2026-01-01T00:00:00Z',
    ageMs: over.ageMs ?? 1200,
    degraded: over.degraded ?? [],
    counts: {
      services: null,
      processesRelevant: null,
      processesTotal: null,
      devices: null,
      network: null,
      projects: null,
      ...(over.counts ?? {}),
    },
  }
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
    expect(state(w, 'metric-agents')).toBe('ready')
    expect(w.get('[data-testid="metric-agents"]').text()).toContain('2')
    expect(w.get('[data-testid="metric-agents"]').text()).toContain('1 running')
    expect(state(w, 'metric-projects')).toBe('ready')
  })

  it('uses empty — a real 0 — when the API returned nothing', async () => {
    const w = await mountMetrics({ agents: [], projects: [] })
    expect(state(w, 'metric-agents')).toBe('empty')
    expect(state(w, 'metric-projects')).toBe('empty')
  })

  it('marks loading rather than showing 0 before the first response', async () => {
    const w = await mountMetrics({ agents: [], agentsLoading: true })
    expect(state(w, 'metric-agents')).toBe('loading')
  })

  it('surfaces an API error as failed, not as empty', async () => {
    const w = await mountMetrics({ agents: [], agentsError: 'boom' })
    expect(state(w, 'metric-agents')).toBe('failed')
  })

  // With the collector down, all three read as unavailable — never as zero.
  it('renders LocalScope metrics as unavailable when the collector is not running', async () => {
    const w = await mountMetrics({
      agents: [{ status: 'idle' }],
      projects: [{ id: 'p' }],
      snapshot: snap({ source: 'unavailable', ageMs: null }),
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
      snapshot: snap({ counts: { services: 4, processesRelevant: 13, processesTotal: 782, devices: 1, projects: 2 } }),
    })
    expect(state(w, 'metric-local-services')).toBe('ready')
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('4')
    expect(state(w, 'metric-devices')).toBe('ready')
    expect(w.get('[data-testid="metric-devices"]').text()).toContain('1')
  })

  // A count LocalScope did not measure stays unknown even though the
  // collector itself is connected and healthy.
  it('keeps a null count unavailable while the collector is healthy', async () => {
    const w = await mountMetrics({
      snapshot: snap({ counts: { services: 4, devices: 0, network: null } }),
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

/*
 * The normalized-snapshot migration.
 *
 * The distinction these protect: an unreachable collector says nothing about
 * the machine, so it must never render as a machine with nothing on it.
 */
describe('overviewMetrics — normalized machine snapshot', () => {
  it('renders a measured zero as 0', async () => {
    const w = await mountMetrics({ snapshot: snap({ counts: { services: 0, devices: 0, network: 0 } }) })
    for (const id of ['metric-local-services', 'metric-devices', 'metric-network']) {
      expect(state(w, id)).toBe('empty')
      expect(w.get(`[data-testid="${id}"]`).text()).toContain('0')
    }
  })

  it('does not render an unknown count as 0', async () => {
    const w = await mountMetrics({ snapshot: snap({ counts: { services: null } }) })
    expect(state(w, 'metric-local-services')).toBe('notAsked')
    expect(w.get('[data-testid="metric-local-services"]').text()).not.toContain('0')
  })

  it('tells a measured zero apart from an unknown, side by side', async () => {
    const w = await mountMetrics({ snapshot: snap({ counts: { devices: 0, network: null } }) })
    expect(state(w, 'metric-devices')).toBe('empty')
    expect(state(w, 'metric-network')).toBe('notAsked')
  })

  it('takes the network count from the snapshot', async () => {
    const w = await mountMetrics({ snapshot: snap({ counts: { network: 22 } }) })
    expect(state(w, 'metric-network')).toBe('ready')
    expect(w.get('[data-testid="metric-network"]').text()).toContain('22')
  })

  // The failure this whole phase exists to prevent.
  it('an unavailable collector does not look like an empty machine', async () => {
    const w = await mountMetrics({ snapshot: snap({ source: 'unavailable', ageMs: null }) })
    for (const id of ['metric-local-services', 'metric-devices', 'metric-network']) {
      expect(state(w, id)).toBe('notAsked')
      expect(w.get(`[data-testid="${id}"]`).text()).not.toContain('0')
      expect(w.get(`[data-testid="${id}"]`).text()).toContain('LocalScope not connected')
    }
  })

  it('keeps a stale reading but labels it as stale, with its age', async () => {
    const w = await mountMetrics({
      snapshot: snap({ source: 'stale', ageMs: 185_000, counts: { services: 4, devices: 1, network: 22 } }),
    })
    // The value survives — discarding it would turn "cannot see the machine"
    // into "the machine is empty".
    expect(state(w, 'metric-local-services')).toBe('ready')
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('4')
    // …but it is never presented as current.
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('stale')
    expect(w.get('[data-testid="metric-local-services"]').text()).toContain('3m ago')
  })

  /*
   * LocalScope's degraded[] is scoped to the whole summary payload, and its
   * source strings are an open vocabulary with no declared mapping to a count.
   * An adb failure therefore says nothing about the services number, and the
   * previous behaviour — pinning every degradation onto every card — made a
   * device-adapter problem read as though the network count were partial.
   */
  it('states a degradation once at machine scope, not on each card', async () => {
    const w = await mountMetrics({
      snapshot: snap({
        source: 'degraded',
        degraded: [{ source: 'adb', reason: 'adb is not installed', kind: 'missing' }],
        counts: { services: 8, devices: null, network: 3 },
      }),
    })
    const machine = w.get('[data-testid="machine-degradation"]')
    expect(machine.text()).toContain('adb')
    expect(machine.text()).toContain('reduced')

    // The unrelated cards keep their own hints and make no partial claim.
    expect(w.get('[data-testid="metric-local-services"]').text()).not.toContain('partial')
    expect(w.get('[data-testid="metric-network"]').text()).not.toContain('partial')
  })

  it('does not claim a degradation when every collector succeeded', async () => {
    const w = await mountMetrics({ snapshot: snap({ source: 'ok', counts: { services: 8 } }) })
    expect(w.find('[data-testid="machine-degradation"]').exists()).toBe(false)
  })

  it('is loading, not zero, before the first response', async () => {
    const w = await mountMetrics({})
    for (const id of ['metric-local-services', 'metric-devices', 'metric-network'])
      expect(state(w, id)).toBe('loading')
  })

  // The migration seam itself: the Overview must not parse LocalScope's
  // envelope any more.
  it('does not consume the raw collector envelope', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/cockpit/components/OverviewMetrics.vue'),
      'utf8',
    )
    expect(src).not.toContain('CollectorResult')
    expect(src).not.toContain('useLocalScopeSummary')
    expect(src).toContain('useLocalMachine')
  })
})
