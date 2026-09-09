import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

/*
 * The LocalScope page's Services and Processes sections, on the normalized
 * model.
 *
 * The distinction these protect: `items: null` means the list is not known and
 * `items: []` means the collector looked and found none. A page that renders
 * both as "no services" reports an unreachable collector as an idle machine.
 */

const service = {
  id: '87234:5173',
  pid: 87234,
  port: 5173,
  address: '127.0.0.1',
  protocol: 'tcp',
  bindScope: 'loopback',
  ipVersion: 'ipv4',
  processName: 'node',
  command: 'node vite.js --port 5173',
  cwd: '/gh/Agent-Dashboard',
  runtime: 'node',
  kind: 'vite',
  label: 'Vite Development Server',
  url: 'http://localhost:5173',
  discoveredProject: {
    id: 'p1',
    name: 'Agent-Dashboard',
    packageName: null,
    rootPath: '/gh/Agent-Dashboard',
    displayPath: '~/gh/Agent-Dashboard',
    manifest: 'package.json',
    git: { isRepo: true, branch: 'main' },
    repo: null,
    frameworks: ['vite'],
  },
  confidence: 'high',
  startedAt: null,
}

const proc = {
  id: '87234',
  pid: 87234,
  ppid: 1,
  name: 'node',
  command: 'node vite.js --port 5173',
  cwd: '/gh/Agent-Dashboard',
  runtime: 'node',
  cpuPercent: 12.5,
  memoryBytes: 104857600,
  elapsedSeconds: 3600,
  startedAt: null,
  ports: [5173],
  relevanceReasons: ['runtime-match', 'listening'],
  discoveredProject: null,
}

function reading(over: Record<string, unknown> = {}) {
  return { source: 'ok', collectedAt: '2026-01-01T00:00:00Z', ageMs: 900, degraded: [], ...over }
}

async function mountPage(opts: {
  services?: Record<string, unknown>
  processes?: Record<string, unknown>
} = {}) {
  vi.resetModules()
  vi.doMock('../../composables/useLocalScope', () => ({
    // The Devices section still reads the raw summary; this phase migrates only
    // Services and Processes, so the fixture keeps that shape intact.
    useLocalScopeSummary: () => ({
      data: {
        value: {
          services: { running: 1 },
          processes: { relevant: 1, total: 818 },
          devices: { connected: 0 },
          network: { active: 22 },
          projects: { active: 1 },
        },
      },
      error: { value: null },
      reachable: { value: true },
      loaded: { value: true },
      refetch: async () => {},
    }),
    useLocalScopeDevices: () => ({
      data: { value: [] },
      error: { value: null },
      reachable: { value: true },
      loaded: { value: true },
      refetch: async () => {},
    }),
  }))
  vi.doMock('../../composables/useMachineLists', () => ({
    useMachineServices: () => ({
      data: { value: reading({ items: [service], ...(opts.services ?? {}) }) },
      loaded: { value: true },
      refetch: async () => {},
    }),
    useMachineProcesses: () => ({
      data: { value: reading({ items: [proc], total: 818, ...(opts.processes ?? {}) }) },
      loaded: { value: true },
      refetch: async () => {},
    }),
  }))
  const C = (await import('../LocalScopeView.vue')).default
  return mount(C)
}

describe('localScope page — normalized lists', () => {
  it('renders normalized services', async () => {
    const w = await mountPage()
    expect(w.find('[data-testid="localscope-services"]').exists()).toBe(true)
    expect(w.text()).toContain('Vite Development Server')
    expect(w.text()).toContain('5173')
    expect(w.text()).toContain('1 listening')
  })

  it('renders normalized processes with their denominator', async () => {
    const w = await mountPage()
    expect(w.find('[data-testid="localscope-processes"]').exists()).toBe(true)
    expect(w.text()).toContain('node')
    expect(w.text()).toContain('1 of 818')
  })

  // The failure this phase exists to prevent.
  it('an unknown service list does not render as no services', async () => {
    const w = await mountPage({ services: { source: 'unavailable', items: null } })
    expect(w.find('[data-testid="services-unknown"]').exists()).toBe(true)
    expect(w.text()).toContain('Service list unavailable')
    expect(w.text()).not.toContain('No listening development services')
  })

  it('an unknown process list does not render as an empty list', async () => {
    const w = await mountPage({ processes: { source: 'unavailable', items: null, total: null } })
    expect(w.find('[data-testid="processes-unknown"]').exists()).toBe(true)
    expect(w.find('[data-testid="localscope-processes"]').exists()).toBe(false)
  })

  // A collected empty list IS an answer and must read differently.
  it('a collected empty service list says so', async () => {
    const w = await mountPage({ services: { items: [] } })
    expect(w.find('[data-testid="services-unknown"]').exists()).toBe(false)
    expect(w.text()).toContain('No listening development services')
  })

  it('keeps a stale list visible and marks it stale', async () => {
    const w = await mountPage({ services: { source: 'stale', ageMs: 185_000 } })
    // The rows survive — dropping them would claim the machine is idle.
    expect(w.find('[data-testid="localscope-services"]').exists()).toBe(true)
    expect(w.text()).toContain('Vite Development Server')
    // …but they are never presented as current.
    expect(w.get('[data-testid="services-freshness"]').text()).toContain('stale')
    expect(w.get('[data-testid="services-freshness"]').text()).toContain('3m ago')
  })

  it('marks a degraded list as partial rather than healthy', async () => {
    const w = await mountPage({
      processes: {
        source: 'degraded',
        degraded: [{ source: 'ps', reason: 'cwd unreadable for some pids', kind: 'partial' }],
      },
    })
    expect(w.get('[data-testid="processes-freshness"]').text()).toContain('partial')
    expect(w.get('[data-testid="processes-freshness"]').text()).toContain('ps')
  })

  // The migration seam: these sections must not read the collector envelope.
  it('the page reads the normalized lists, not the raw service/process pollers', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/localscope/components/LocalScopeView.vue'),
      'utf8',
    )
    expect(src).toContain('useMachineServices')
    expect(src).toContain('useMachineProcesses')
    expect(src).not.toContain('useLocalScopeServices')
    expect(src).not.toContain('useLocalScopeProcesses')
  })
})
