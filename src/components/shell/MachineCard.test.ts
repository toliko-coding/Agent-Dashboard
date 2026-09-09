import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * CPU / MEM / DISK pressure colouring used to live in AppStatusBar's strip.
 * It moved here in the Phase 2 shell work so the numbers appear exactly once;
 * these cases are the relocated coverage for that behaviour, including the
 * 75 / 90 thresholds.
 */
function mockResources(cpu: number, mem: number, disk: number) {
  vi.doMock('../../composables/useSystemResources', () => ({
    useSystemResources: () => ({
      info: {
        value: {
          cpu: { usage: cpu, cores: 8, model: 'Apple M1' },
          memory: { total: 100, used: mem, available: 100 - mem, usagePercent: mem },
          disk: { total: 100, used: disk, available: 100 - disk, usagePercent: disk, mount: '/' },
          loadAvg: [1.2, 1.0, 0.8],
          uptime: 100,
        },
      },
      error: { value: null },
    }),
  }))
}

async function load() {
  vi.resetModules()
  return (await import('./MachineCard.vue')).default
}

describe('machineCard', () => {
  beforeEach(() => vi.resetModules())

  it('renders nothing when the rail is collapsed', async () => {
    mockResources(34, 62, 48)
    const C = await load()
    const w = mount(C, { props: { expanded: false } })
    expect(w.find('[data-testid="machine-card"]').exists()).toBe(false)
  })

  it('renders CPU, memory and disk percentages when expanded', async () => {
    mockResources(34, 62, 48)
    const C = await load()
    const w = mount(C, { props: { expanded: true } })
    expect(w.text()).toContain('34%')
    expect(w.text()).toContain('62%')
    expect(w.text()).toContain('48%')
  })

  it('does not colour metrics below the warning threshold', async () => {
    mockResources(34, 62, 48)
    const C = await load()
    const w = mount(C, { props: { expanded: true } })
    expect(w.html()).not.toContain('text-warning-text')
    expect(w.html()).not.toContain('text-danger-text')
  })

  it('colours warning at >=75%', async () => {
    mockResources(80, 78, 76)
    const C = await load()
    const w = mount(C, { props: { expanded: true } })
    expect(w.html()).toContain('text-warning-text')
    expect(w.html()).not.toContain('text-danger-text')
  })

  it('colours danger at >=90%', async () => {
    mockResources(95, 91, 90)
    const C = await load()
    const w = mount(C, { props: { expanded: true } })
    expect(w.html()).toContain('text-danger-text')
  })

  // A zero here would claim the collector looked and found no traffic; there is
  // no network collector at all, so it must read as unavailable.
  it('marks network unavailable rather than showing a fabricated zero', async () => {
    mockResources(34, 62, 48)
    const C = await load()
    const w = mount(C, { props: { expanded: true } })
    const net = w.get('[data-testid="machine-network-unavailable"]')
    expect(net.text()).toContain('n/a')
    expect(net.text()).not.toContain('0%')
  })
})
