import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/agents', () => ({
  useAgents: () => ({ agents: { value: [{ sessionId: 'a' }, { sessionId: 'b' }] } }),
}))
vi.mock('@/composables/useProjects', () => ({
  useProjects: () => ({ projects: { value: [{ id: 'p' }] } }),
}))
vi.mock('@/composables/useSystemResources', () => ({
  useSystemResources: () => ({ info: { value: { cpu: { model: 'Apple M1' } } }, error: { value: null } }),
}))

/*
 * The map now reads the dashboard's normalized snapshot — the same object and
 * the same poller the Overview uses. `reachable: false` maps onto the snapshot
 * saying `unavailable`.
 */
const NO_COUNTS = {
  services: null,
  processesRelevant: null,
  processesTotal: null,
  devices: null,
  network: null,
  projects: null,
}
let lsSnapshot: any = { source: 'unavailable', collectedAt: null, ageMs: null, degraded: [], counts: NO_COUNTS }
vi.mock('@/features/localscope', () => ({
  useLocalMachine: () => ({
    snapshot: { value: lsSnapshot },
    loaded: { value: true },
    refetch: async () => {},
  }),
}))

function mockLocalScope(next: { reachable: boolean | null, data?: any, source?: string }) {
  const counts = next.data
    ? {
        ...NO_COUNTS,
        services: next.data.services?.running ?? null,
        processesRelevant: next.data.processes?.relevant ?? null,
        processesTotal: next.data.processes?.total ?? null,
        devices: next.data.devices?.connected ?? null,
        network: next.data.network?.active ?? null,
        projects: next.data.projects?.active ?? null,
      }
    : NO_COUNTS
  lsSnapshot = {
    source: next.source ?? (next.reachable === true ? 'ok' : 'unavailable'),
    collectedAt: next.reachable === true ? '2026-01-01T00:00:00Z' : null,
    ageMs: next.reachable === true ? 1000 : null,
    degraded: [],
    counts,
  }
}

const stubs = { CockpitPanel: { template: '<div><slot /></div>' } }

async function mountMap() {
  const SystemMap = (await import('./SystemMap.vue')).default
  return mount(SystemMap, { global: { stubs } })
}

describe('systemMap', () => {
  it('marks agents and projects available, driven by real counts', async () => {
    mockLocalScope({ reachable: false })
    const w = await mountMap()
    expect(w.get('[data-testid="map-node-agents"]').attributes('data-available')).toBe('true')
    expect(w.get('[data-testid="map-node-projects"]').attributes('data-available')).toBe('true')
    expect(w.text()).toContain('2 running')
    expect(w.text()).toContain('1 registered')
  })

  // With the collector down, the LocalScope-fed nodes read as not connected.
  it('marks the LocalScope-fed nodes unavailable when the collector is absent', async () => {
    mockLocalScope({ reachable: false })
    const w = await mountMap()
    for (const id of ['localscope', 'services', 'emulators', 'network'])
      expect(w.get(`[data-testid="map-node-${id}"]`).attributes('data-available')).toBe('false')
    expect(w.text()).toContain('Not connected')
  })

  it('does not claim zero services when nothing was collected', async () => {
    mockLocalScope({ reachable: false })
    const w = await mountMap()
    const services = w.get('[data-testid="map-node-services"]')
    expect(services.text()).not.toContain('0')
    expect(services.text()).toContain('Not connected')
  })

  it('activates the service and device nodes with real counts once connected', async () => {
    mockLocalScope({
      reachable: true,
      data: {
        services: { running: 4 },
        processes: { relevant: 13, total: 782 },
        devices: { connected: 1 },
        network: { active: null },
        projects: { active: 2 },
      },
    })
    const w = await mountMap()
    expect(w.get('[data-testid="map-node-localscope"]').attributes('data-available')).toBe('true')
    expect(w.get('[data-testid="map-node-services"]').attributes('data-available')).toBe('true')
    expect(w.get('[data-testid="map-node-services"]').text()).toContain('4 listening')
    expect(w.get('[data-testid="map-node-emulators"]').text()).toContain('1 connected')

    // Network has no collector even when LocalScope runs — it stays dashed.
    const network = w.get('[data-testid="map-node-network"]')
    expect(network.attributes('data-available')).toBe('false')
    expect(network.text()).toContain('Not collected')
  })

  it('navigates from a real node', async () => {
    const w = await mountMap()
    await w.get('[data-testid="map-node-agents"]').trigger('click')
    expect(w.emitted('navigate')?.[0]).toEqual(['dashboard'])
  })

  it('gives the diagram a text alternative', async () => {
    const w = await mountMap()
    const svg = w.get('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBeTruthy()
  })

  // The panel is narrower than the diagram on small screens; it must scroll in
  // its own box rather than widening the page.
  it('keeps the diagram in a horizontally scrollable container', async () => {
    const w = await mountMap()
    expect(w.get('[data-testid="system-map"]').classes()).toContain('overflow-x-auto')
  })
})

/*
 * The map and the Overview must derive machine state from the SAME normalized
 * snapshot. Two surfaces reading the collector separately could show different
 * counts at the same moment, which the user would have no way to explain.
 */
describe('systemMap — normalized snapshot', () => {
  it('consumes useLocalMachine, not the raw summary poller', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/SystemMap.vue'), 'utf8')
    expect(src).toContain('useLocalMachine')
    expect(src).not.toContain('useLocalScopeSummary')
    expect(src).not.toContain('CollectorResult')
  })

  it('reads the same counts the Overview does, from one snapshot shape', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const overview = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/OverviewMetrics.vue'), 'utf8')
    const map = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/SystemMap.vue'), 'utf8')
    // Both reach for counts on the snapshot rather than interpreting an
    // envelope of their own.
    expect(overview).toContain('useLocalMachine')
    expect(map).toContain('useLocalMachine')
    expect(overview).toContain('.counts')
    expect(map).toContain('.counts')
  })

  it('shows a stale reading with its value, marked stale', async () => {
    mockLocalScope({
      reachable: true,
      source: 'stale',
      data: { services: { running: 4 }, devices: { connected: 1 }, network: { active: 22 } },
    })
    const w = await mountMap()
    expect(w.text()).toContain('4 listening (stale)')
    expect(w.text()).toContain('1 connected (stale)')
  })

  it('does not turn an unavailable collector into zero counts', async () => {
    mockLocalScope({ reachable: false })
    const w = await mountMap()
    expect(w.text()).toContain('Not connected')
    expect(w.text()).not.toContain('0 listening')
    expect(w.text()).not.toContain('0 connected')
  })
})
