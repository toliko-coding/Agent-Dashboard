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

// Overridden per-test via mockLocalScope(); defaults to collector absent.
let lsState: { reachable: boolean | null, data: any } = { reachable: false, data: null }
vi.mock('@/features/localscope', () => ({
  useLocalScopeSummary: () => ({
    data: { value: lsState.data },
    error: { value: null },
    reachable: { value: lsState.reachable },
    loaded: { value: lsState.reachable !== null },
    refetch: async () => {},
  }),
}))

function mockLocalScope(next: { reachable: boolean | null, data?: any }) {
  lsState = { reachable: next.reachable, data: next.data ?? null }
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
