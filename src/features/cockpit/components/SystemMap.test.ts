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

const stubs = { CockpitPanel: { template: '<div><slot /></div>' } }

async function mountMap() {
  const SystemMap = (await import('./SystemMap.vue')).default
  return mount(SystemMap, { global: { stubs } })
}

describe('systemMap', () => {
  it('marks agents and projects available, driven by real counts', async () => {
    const w = await mountMap()
    expect(w.get('[data-testid="map-node-agents"]').attributes('data-available')).toBe('true')
    expect(w.get('[data-testid="map-node-projects"]').attributes('data-available')).toBe('true')
    expect(w.text()).toContain('2 running')
    expect(w.text()).toContain('1 registered')
  })

  // The three collectorless nodes must read as unavailable, not as empty.
  it('marks LocalScope, services, emulators and network unavailable', async () => {
    const w = await mountMap()
    for (const id of ['localscope', 'services', 'emulators', 'network'])
      expect(w.get(`[data-testid="map-node-${id}"]`).attributes('data-available')).toBe('false')
    expect(w.text()).toContain('Not connected')
    expect(w.text()).toContain('Not collected')
  })

  it('does not claim zero services — it claims nothing was collected', async () => {
    const w = await mountMap()
    const services = w.get('[data-testid="map-node-services"]')
    expect(services.text()).not.toContain('0')
    expect(services.text()).toContain('Not collected')
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
