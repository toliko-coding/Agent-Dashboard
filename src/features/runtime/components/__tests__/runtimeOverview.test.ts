import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import RuntimeOverview from '../RuntimeOverview.vue'

/*
 * The Runtime Overview (3K) — the merged LocalScope summary and System page.
 *
 * Carries forward the System view's rules (G/H/I) and adds the ones the merge
 * introduces: machine resources are the dashboard server's own measurement and
 * say so, and they stay visible whatever LocalScope's state.
 */

const state = vi.hoisted(() => ({
  snapshot: null as any,
  loaded: true,
  info: null as any,
  error: null as string | null,
  agents: [] as any[],
  lastUpdatedAt: 1 as number | null,
}))

vi.mock('@/features/localscope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/localscope')>()
  const { ref } = await import('vue')
  return { ...real, useLocalMachine: () => ({ snapshot: ref(state.snapshot), loaded: ref(state.loaded), refetch: async () => {} }) }
})
vi.mock('@/composables/useSystemResources', async () => {
  const { ref } = await import('vue')
  return { useSystemResources: () => ({ info: ref(state.info), error: ref(state.error), refetch: async () => {} }) }
})
vi.mock('@/composables/useBuildVersion', async () => {
  const { ref } = await import('vue')
  return { useBuildVersion: () => ({ version: ref('1.2.3') }) }
})
vi.mock('@/features/agents', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  const { ref } = await import('vue')
  return { ...real, useAgents: () => ({ agents: ref(state.agents), lastUpdatedAt: ref(state.lastUpdatedAt) }) }
})

const COUNTS = { services: 8, processesRelevant: 45, processesTotal: 854, devices: 2, network: 38, projects: 7 }
const NULL_COUNTS = { services: null, processesRelevant: null, processesTotal: null, devices: null, network: null, projects: null }

function reading(over: Record<string, unknown> = {}) {
  return { source: 'ok', collectedAt: '2026-09-14T00:00:00Z', ageMs: 900, degraded: [], counts: COUNTS, ...over }
}

const INFO = {
  cpu: { usage: 20, cores: 8, model: 'Apple M1' },
  memory: { usagePercent: 80, used: 8 * 1024 ** 3, total: 16 * 1024 ** 3, available: 0 },
  disk: { usagePercent: 95, used: 500 * 1024 ** 3, total: 900 * 1024 ** 3, available: 0, mount: '/System/Volumes/Data' },
  loadAvg: [1, 2, 3],
  uptime: 3600,
}

function ws(id: string, repo: string): WorkspaceRef {
  return { id, name: 'app', kind: 'git-main', branch: 'main', repository: { id: repo, name: 'app' } } as WorkspaceRef
}
function agent(sessionId: string, workspace: WorkspaceRef | null, status = 'active'): Agent {
  return { sessionId, pid: 1, status, working: false, workspace } as unknown as Agent
}

beforeEach(() => {
  state.snapshot = reading()
  state.loaded = true
  state.info = INFO
  state.error = null
  state.agents = []
  state.lastUpdatedAt = 1
})

const render = () => mount(RuntimeOverview)
const cell = (w: ReturnType<typeof render>, key: string) => w.get(`[data-testid="runtime-overview-${key}"]`)

describe('runtime overview — local runtime counts', () => {
  it('shows the collected counts, with the process denominator', () => {
    const w = render()
    expect(cell(w, 'services').text()).toContain('8')
    expect(cell(w, 'services').text()).toContain('listening')
    expect(cell(w, 'processes').text()).toContain('45')
    expect(cell(w, 'processes').text()).toContain('of 854')
    expect(cell(w, 'devices').text()).toContain('2')
    expect(cell(w, 'network').text()).toContain('38')
  })

  // A
  it('renders a measured 0 as 0 and a null count as Not collected, never 0', () => {
    state.snapshot = reading({ counts: { ...COUNTS, services: 0, devices: 0, network: null } })
    const z = render()
    expect(cell(z, 'services').attributes('data-state')).toBe('measured')
    expect(cell(z, 'services').text()).toContain('0')
    expect(cell(z, 'services').text()).not.toContain('Not collected')
    expect(cell(z, 'devices').attributes('data-state')).toBe('measured')
    expect(cell(z, 'network').attributes('data-state')).toBe('unknown')
    expect(cell(z, 'network').text()).toContain('Not collected')
    expect(cell(z, 'network').text()).not.toMatch(/\b0\b/)
  })

  it('omits a denominator it does not have rather than guessing one', () => {
    state.snapshot = reading({ counts: { ...COUNTS, processesTotal: null } })
    const text = cell(render(), 'processes').text()
    expect(text).toContain('45')
    expect(text).toContain('developer')
    expect(text).not.toContain('of')
  })

  // B
  it('keeps a stale reading and says how old it is', () => {
    state.snapshot = reading({ source: 'stale', ageMs: 180_000 })
    const w = render()
    expect(cell(w, 'services').text()).toContain('8')
    expect(w.get('[data-testid="runtime-overview-freshness"]').text()).toContain('stale · 3m ago')
    expect(w.get('[data-testid="runtime-overview-local"]').attributes('data-state')).toBe('reading')
  })

  // C
  it('names a degraded source and keeps the counts', () => {
    state.snapshot = reading({ source: 'degraded', degraded: [{ source: 'simctl', reason: 'x', kind: 'partial' }] })
    const w = render()
    expect(w.get('[data-testid="runtime-overview-freshness"]').text()).toContain('partial · simctl')
    expect(cell(w, 'devices').text()).toContain('2')
  })

  it('states an unavailable collector as unknown, with no counts and how to start it', () => {
    state.snapshot = { ...reading({ source: 'unavailable', collectedAt: null, ageMs: null }), counts: NULL_COUNTS }
    const w = render()
    expect(w.get('[data-testid="runtime-overview-unavailable"]').text()).toContain('unknown — not zero')
    expect(w.get('[data-testid="runtime-overview-start-hint"]').text()).toContain('pnpm dev:collector')
    expect(w.find('[data-testid="runtime-overview-counts"]').exists()).toBe(false)
    expect(w.find('[data-testid="runtime-overview-freshness"]').exists()).toBe(false)
  })

  it('says it is connecting before the first reading, not that nothing exists', () => {
    state.snapshot = { ...reading({ source: 'unavailable' }), counts: NULL_COUNTS }
    state.loaded = false
    const w = render()
    expect(w.find('[data-testid="runtime-overview-connecting"]').exists()).toBe(true)
    expect(w.find('[data-testid="runtime-overview-unavailable"]').exists()).toBe(false)
  })

  // L
  it('names network throughput as not collected, and offers no network detail view', () => {
    const w = render()
    expect(w.get('[data-testid="runtime-overview-throughput"]').text()).toContain('Network throughput is not collected')
    expect(cell(w, 'network').find('button').exists()).toBe(false)
    expect(w.text()).not.toMatch(/\b(?:KB|MB|GB)\/s\b|throughput: \d/)
  })

  it('opens the section a count belongs to', async () => {
    const w = render()
    await cell(w, 'services').get('button').trigger('click')
    await cell(w, 'devices').get('button').trigger('click')
    expect(w.emitted('openSection')).toEqual([['services'], ['devices']])
  })
})

describe('runtime overview — this machine (merged from System)', () => {
  it('is attributed to the dashboard server, not to LocalScope', () => {
    const block = render().get('[data-testid="runtime-machine"]')
    expect(block.text()).toContain('measured by the dashboard server')
    expect(block.text()).not.toContain('LocalScope')
  })

  it('states resource levels in words as well as colour', () => {
    const w = render()
    expect(w.get('[data-testid="runtime-machine-cpu"]').attributes('data-level')).toBe('normal')
    expect(w.get('[data-testid="runtime-machine-memory"]').attributes('data-level')).toBe('high')
    expect(w.get('[data-testid="runtime-machine-memory"]').text()).toContain('High')
    expect(w.get('[data-testid="runtime-machine-disk"]').text()).toContain('Critical')
    expect(w.get('[data-testid="runtime-machine-disk"]').text()).toContain('95%')
  })

  it('keeps the host facts', () => {
    const host = render().get('[data-testid="runtime-host"]').text()
    expect(host).toContain('Apple M1')
    expect(host).toContain('1.00  2.00  3.00')
    expect(host).toContain('1h 0m')
    expect(host).toContain('1.2.3')
  })

  it('stays visible while LocalScope is unavailable', () => {
    state.snapshot = { ...reading({ source: 'unavailable', collectedAt: null, ageMs: null }), counts: NULL_COUNTS }
    expect(render().find('[data-testid="runtime-machine-cpu"]').exists()).toBe(true)
  })

  it('says loading, then the error, and keeps a previous reading when an update fails', () => {
    state.info = null
    expect(render().find('[data-testid="runtime-machine-loading"]').exists()).toBe(true)
    state.error = 'Failed to load system info (500)'
    expect(render().get('[data-testid="runtime-machine-error"]').text()).toContain('500')
    state.info = INFO
    const w = render()
    expect(w.find('[data-testid="runtime-machine-retained"]').exists()).toBe(true)
    expect(w.find('[data-testid="runtime-machine-cpu"]').exists()).toBe(true)
  })
})

describe('runtime overview — agents', () => {
  it('waits for the agent stream rather than reporting zero agents', () => {
    state.lastUpdatedAt = null
    const w = render()
    expect(w.find('[data-testid="runtime-overview-agents-waiting"]').exists()).toBe(true)
    expect(w.get('[data-testid="runtime-overview-agents"]').text()).not.toMatch(/\b0\b/)
  })

  it('counts where running agents are by identity, finished sessions excluded', async () => {
    state.agents = [
      agent('a', ws('ws1', 'repo1')),
      agent('b', ws('ws2', 'repo1')),
      agent('c', null),
      agent('d', ws('ws3', 'repo2'), 'finished'),
    ]
    const w = render()
    const block = w.get('[data-testid="runtime-overview-agents"]')
    expect(block.text()).toContain('3')
    expect(w.get('[data-testid="runtime-overview-footprint"]').text()).toBe('in 1 repository · 2 workspaces · 1 with workspace unknown')
    await w.get('[data-testid="runtime-overview-open-workspaces"]').trigger('click')
    expect(w.emitted('openSection')).toEqual([['workspaces']])
  })
})

describe('runtime overview — privacy and accessibility', () => {
  // H
  it('shows no filesystem path, including the disk mount point', () => {
    const html = render().html()
    expect(html).not.toContain('/Users/')
    expect(html).not.toContain('/System/Volumes')
  })

  it('uses a section heading and one heading per block', () => {
    const w = render()
    expect(w.findAll('h2').map(h => h.text())).toEqual(['Overview'])
    expect(w.findAll('h3').map(h => h.text())).toEqual(['Local runtime', 'Agents', 'This machine'])
  })

  // R
  it('has no axe violations', async () => {
    const w = mount(RuntimeOverview, { attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
