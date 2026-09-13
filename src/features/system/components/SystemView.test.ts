import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SystemView from './SystemView.vue'

/*
 * The System view's local runtime block. Until 3B it claimed listening ports,
 * processes and emulators were "Not collected yet" while LocalScope collected
 * all three. The block now reads the normalized snapshot and must keep its
 * rules: a number (including 0) is measured, null is unknown, unavailable is a
 * sentence, and stale or degraded readings say so.
 */

let snapshot: any
let loaded = true

vi.mock('../../../composables/useSystemResources', () => ({
  useSystemResources: () => ({
    info: {
      value: {
        cpu: { usage: 20, cores: 8, model: 'Apple M1' },
        memory: { usagePercent: 50, used: 8 * 1024 ** 3, total: 16 * 1024 ** 3 },
        disk: { usagePercent: 60, used: 500 * 1024 ** 3, total: 900 * 1024 ** 3, mount: '/' },
        loadAvg: [1, 2, 3],
        uptime: 3600,
      },
    },
    error: { value: null },
  }),
}))

vi.mock('../../../composables/useBuildVersion', async () => {
  const { ref } = await import('vue')
  return { useBuildVersion: () => ({ version: ref('dev') }) }
})

vi.mock('@/features/localscope', async () => {
  const { ref } = await import('vue')
  return {
    useLocalMachine: () => ({ snapshot: ref(snapshot), loaded: ref(loaded), refetch: async () => {} }),
    // The real indicator, so freshness assertions check what actually renders.
    DataFreshnessIndicator: (await import('@/features/localscope/components/DataFreshnessIndicator.vue')).default,
  }
})

const COUNTS = { services: 8, processesRelevant: 45, processesTotal: 854, devices: 2, network: 38, projects: 7 }

function reading(over: Record<string, unknown> = {}) {
  return { source: 'ok', collectedAt: '2026-09-14T00:00:00Z', ageMs: 900, degraded: [], counts: COUNTS, ...over }
}

function render(next: any, isLoaded = true) {
  snapshot = next
  loaded = isLoaded
  return mount(SystemView)
}

const row = (w: ReturnType<typeof render>, key: string) => w.get(`[data-testid="system-runtime-${key}"]`)

describe('systemView — local runtime truth (G)', () => {
  it('no longer claims collected metrics are "Not collected yet"', () => {
    const w = render(reading())
    expect(w.text()).not.toContain('Not collected yet')
    expect(w.text()).not.toContain('Listening ports — n/a')
    expect(w.text()).not.toContain('Processes — n/a')
    expect(w.text()).not.toContain('Emulators — n/a')
  })

  it('shows the collected counts', () => {
    const w = render(reading())
    expect(row(w, 'services').text()).toContain('8')
    expect(row(w, 'processes').text()).toContain('45')
    expect(row(w, 'processes').text()).toContain('of 854')
    expect(row(w, 'devices').text()).toContain('2')
    expect(row(w, 'network').text()).toContain('38')
  })

  it('still names the one gap that is real: network throughput', () => {
    expect(render(reading()).get('[data-testid="system-runtime-throughput"]').text()).toContain('Network throughput is not collected')
  })
})

describe('systemView — measured zero versus unknown (H)', () => {
  it('renders a measured 0 as 0', () => {
    const w = render(reading({ counts: { ...COUNTS, services: 0, devices: 0 } }))
    expect(row(w, 'services').attributes('data-state')).toBe('measured')
    expect(row(w, 'services').text()).toContain('0')
    expect(row(w, 'services').text()).not.toContain('Not collected')
    expect(row(w, 'devices').attributes('data-state')).toBe('measured')
  })

  it('renders null as unknown, never as 0', () => {
    const w = render(reading({ counts: { ...COUNTS, network: null } }))
    expect(row(w, 'network').attributes('data-state')).toBe('unknown')
    expect(row(w, 'network').text()).toContain('Not collected')
    expect(row(w, 'network').text()).not.toMatch(/\b0\b/)
  })

  it('omits a denominator it does not have rather than guessing one', () => {
    const w = render(reading({ counts: { ...COUNTS, processesTotal: null } }))
    expect(row(w, 'processes').text()).toContain('45')
    expect(row(w, 'processes').text()).not.toContain('of')
  })
})

describe('systemView — stale, degraded and unavailable stay honest (I)', () => {
  it('keeps a stale reading and says how old it is', () => {
    const w = render(reading({ source: 'stale', ageMs: 180_000 }))
    expect(row(w, 'services').text()).toContain('8')
    expect(w.get('[data-testid="system-runtime-freshness"]').text()).toContain('stale · 3m ago')
  })

  it('names a degraded source once, for the whole reading', () => {
    const w = render(reading({ source: 'degraded', degraded: [{ source: 'simctl', reason: 'x', kind: 'partial' }] }))
    expect(w.get('[data-testid="system-runtime-freshness"]').text()).toContain('partial · simctl')
    expect(row(w, 'devices').text()).toContain('2')
  })

  it('states an unavailable collector as unknown, with no counts at all', () => {
    const w = render({ ...reading({ source: 'unavailable', collectedAt: null, ageMs: null }), counts: { services: null, processesRelevant: null, processesTotal: null, devices: null, network: null, projects: null } })
    expect(w.get('[data-testid="system-runtime-unavailable"]').text()).toContain('unknown — not zero')
    expect(w.find('[data-testid="system-runtime-services"]').exists()).toBe(false)
  })

  it('says it is connecting before the first reading, not that nothing exists', () => {
    const w = render(reading({ source: 'unavailable' }), false)
    expect(w.find('[data-testid="system-runtime-connecting"]').exists()).toBe(true)
    expect(w.find('[data-testid="system-runtime-unavailable"]').exists()).toBe(false)
  })

  it('shows no filesystem path from the runtime block', () => {
    const html = render(reading()).get('[data-testid="system-runtime"]').html()
    expect(html).not.toContain('/Users/')
  })
})

describe('systemView — legibility', () => {
  // Found live: whitespace between elements is condensed, so "8 listening"
  // rendered as "8listening". The separation must be structural.
  it('separates each value from its unit', () => {
    const dd = render(reading()).get('[data-testid="system-runtime-services"] dd')
    expect(dd.classes()).toEqual(expect.arrayContaining(['flex', 'gap-1']))
    expect(dd.findAll('span').map(s => s.text())).toEqual(['8', 'listening'])
  })
})
