import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

/*
 * The LocalScope page, entirely on the normalized model.
 *
 * The distinction these protect: `items: null` means the list is not known and
 * `items: []` means the collector looked and found none. A page that renders
 * both as "no services" reports an unreachable collector as an idle machine.
 *
 * The second property, added when the banner migrated: no single unavailable
 * category may blank the page. A collector that has gone away leaves behind a
 * reading that was true minutes ago, and hiding it would replace "I cannot see
 * this machine" with "this machine has nothing on it".
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

const device = {
  id: 'android:emulator-5554',
  serial: 'emulator-5554',
  platform: 'android',
  form: 'emulator',
  state: 'online',
  model: 'sdk gphone64 arm64',
  osVersion: 'Android 13',
}

function reading(over: Record<string, unknown> = {}) {
  return { source: 'ok', collectedAt: '2026-01-01T00:00:00Z', ageMs: 900, degraded: [], ...over }
}

const COUNTS = {
  services: 1,
  processesRelevant: 1,
  processesTotal: 818,
  devices: 1,
  network: 22,
  projects: 1,
}

async function mountPage(opts: {
  machine?: Record<string, unknown>
  services?: Record<string, unknown>
  processes?: Record<string, unknown>
  devices?: Record<string, unknown>
  loaded?: boolean
} = {}) {
  vi.resetModules()
  const loaded = { value: opts.loaded ?? true }
  vi.doMock('../../composables/useLocalMachine', () => ({
    useLocalMachine: () => ({
      snapshot: { value: { ...reading({ counts: COUNTS }), ...(opts.machine ?? {}) } },
      loaded,
      refetch: async () => {},
    }),
  }))
  vi.doMock('../../composables/useMachineLists', () => ({
    useMachineServices: () => ({
      data: { value: reading({ items: [service], ...(opts.services ?? {}) }) },
      loaded,
      refetch: async () => {},
    }),
    useMachineProcesses: () => ({
      data: { value: reading({ items: [proc], total: 818, ...(opts.processes ?? {}) }) },
      loaded,
      refetch: async () => {},
    }),
    useMachineDevices: () => ({
      data: { value: reading({ items: [device], connected: 1, ...(opts.devices ?? {}) }) },
      loaded,
      refetch: async () => {},
    }),
  }))
  const C = (await import('../LocalScopeView.vue')).default
  return mount(C)
}

/** Every reading unavailable — the collector has never been observed. */
const NOTHING = {
  machine: { source: 'unavailable', collectedAt: null, ageMs: null, counts: {
    services: null,
    processesRelevant: null,
    processesTotal: null,
    devices: null,
    network: null,
    projects: null,
  } },
  services: { source: 'unavailable', items: null },
  processes: { source: 'unavailable', items: null, total: null },
  devices: { source: 'unavailable', items: null, connected: null },
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

  // The migration seam: the page must read no raw collector poller at all.
  it('the page reads normalized models, not the raw collector pollers', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(
      resolve(process.cwd(), 'src/features/localscope/components/LocalScopeView.vue'),
      'utf8',
    )
    expect(src).toContain('useMachineServices')
    expect(src).toContain('useMachineProcesses')
    expect(src).toContain('useMachineDevices')
    expect(src).toContain('useLocalMachine')
    expect(src).not.toContain('useLocalScopeSummary')
    expect(src).not.toContain('useLocalScopeServices')
    expect(src).not.toContain('useLocalScopeProcesses')
    expect(src).not.toContain('useLocalScopeDevices')
    expect(src).not.toContain('CollectorResult')
  })
})

describe('localScope page — banner state', () => {
  it('shows nothing but the placeholder when the machine was never observed', async () => {
    const w = await mountPage(NOTHING)
    expect(w.find('[data-testid="localscope-placeholder"]').exists()).toBe(true)
    expect(w.text()).toContain('LocalScope is not running')
    expect(w.find('[data-testid="localscope-services"]').exists()).toBe(false)
  })

  it('waits for the first response rather than claiming the collector is down', async () => {
    const w = await mountPage({ ...NOTHING, loaded: false })
    expect(w.find('[data-testid="localscope-connecting"]').exists()).toBe(true)
    expect(w.find('[data-testid="localscope-placeholder"]').exists()).toBe(false)
  })

  it('shows no banner when everything is healthy', async () => {
    const w = await mountPage()
    expect(w.find('[data-testid="localscope-banner-stale"]').exists()).toBe(false)
    expect(w.find('[data-testid="localscope-banner-degraded"]').exists()).toBe(false)
    expect(w.find('[data-testid="localscope-placeholder"]').exists()).toBe(false)
  })

  it('names the degraded sources rather than reading as healthy', async () => {
    const w = await mountPage({
      machine: {
        source: 'degraded',
        degraded: [{ source: 'simctl', reason: '30 simulators unavailable', kind: 'partial' }],
      },
    })
    const banner = w.get('[data-testid="localscope-banner-degraded"]')
    expect(banner.text()).toContain('simctl')
    expect(banner.text()).toContain('connected')
  })

  it('a stale banner says the collector is gone and how old the reading is', async () => {
    const w = await mountPage({ machine: { source: 'stale', ageMs: 185_000 } })
    const banner = w.get('[data-testid="localscope-banner-stale"]')
    expect(banner.text()).toContain('not responding')
    expect(banner.text()).toContain('3m ago')
  })

  /*
   * The defect this checkpoint exists to fix: a stale machine used to render
   * the "start the collector" placeholder and drop every retained section.
   */
  it('a stale machine keeps every section visible', async () => {
    const w = await mountPage({
      machine: { source: 'stale', ageMs: 120_000 },
      services: { source: 'stale', ageMs: 120_000 },
      processes: { source: 'stale', ageMs: 120_000 },
      devices: { source: 'stale', ageMs: 120_000 },
    })
    expect(w.find('[data-testid="localscope-placeholder"]').exists()).toBe(false)
    expect(w.text()).not.toContain('LocalScope is not running')
    expect(w.find('[data-testid="localscope-services"]').exists()).toBe(true)
    expect(w.find('[data-testid="localscope-processes"]').exists()).toBe(true)
    expect(w.find('[data-testid="localscope-devices"]').exists()).toBe(true)
  })

  // Per-section state: one category failing must not erase the others.
  it('one unavailable category does not hide the valid ones', async () => {
    const w = await mountPage({ devices: { source: 'unavailable', items: null, connected: null } })
    expect(w.find('[data-testid="devices-unknown"]').exists()).toBe(true)
    expect(w.find('[data-testid="localscope-services"]').exists()).toBe(true)
    expect(w.find('[data-testid="localscope-processes"]').exists()).toBe(true)
  })
})

describe('localScope page — devices', () => {
  it('renders normalized devices with their count', async () => {
    const w = await mountPage()
    expect(w.find('[data-testid="localscope-devices"]').exists()).toBe(true)
    expect(w.text()).toContain('sdk gphone64 arm64')
    expect(w.text()).toContain('android · emulator')
    expect(w.text()).toContain('1 connected')
  })

  // Three claims, three sentences.
  it('a collected empty device list says zero, not unknown', async () => {
    const w = await mountPage({ devices: { items: [], connected: 0 } })
    expect(w.find('[data-testid="devices-none"]').exists()).toBe(true)
    expect(w.find('[data-testid="devices-unknown"]').exists()).toBe(false)
    expect(w.find('[data-testid="devices-unavailable"]').exists()).toBe(false)
    expect(w.text()).toContain('0 connected')
  })

  it('an unknown device list is not an empty one', async () => {
    const w = await mountPage({ devices: { source: 'unavailable', items: null, connected: null } })
    expect(w.find('[data-testid="devices-unknown"]').exists()).toBe(true)
    expect(w.find('[data-testid="devices-none"]').exists()).toBe(false)
    expect(w.text()).not.toContain('0 connected')
  })

  // adb missing: the adapters never ran, so the empty list is not a zero.
  it('no adapter having run reads differently from zero devices', async () => {
    const w = await mountPage({
      devices: {
        source: 'degraded',
        items: [],
        connected: null,
        degraded: [{ source: 'adb', reason: 'adb is not on PATH', kind: 'missing' }],
      },
    })
    const note = w.get('[data-testid="devices-unavailable"]')
    expect(note.text()).toContain('No device adapter could run')
    expect(note.text()).toContain('adb')
    expect(note.text()).toContain('not the same as zero devices')
    expect(w.find('[data-testid="devices-none"]').exists()).toBe(false)
    expect(w.text()).not.toContain('0 connected')
  })

  it('keeps stale devices visible and marks them stale', async () => {
    const w = await mountPage({ devices: { source: 'stale', ageMs: 185_000 } })
    expect(w.find('[data-testid="localscope-devices"]').exists()).toBe(true)
    expect(w.text()).toContain('sdk gphone64 arm64')
    expect(w.get('[data-testid="devices-freshness"]').text()).toContain('stale')
    expect(w.get('[data-testid="devices-freshness"]').text()).toContain('3m ago')
  })

  it('marks a partially degraded device list as partial', async () => {
    const w = await mountPage({
      devices: {
        source: 'degraded',
        degraded: [{ source: 'simctl', reason: '30 simulators unavailable', kind: 'partial' }],
      },
    })
    expect(w.get('[data-testid="devices-freshness"]').text()).toContain('partial · simctl')
    // A partial run still counted, so the devices it found are still real.
    expect(w.find('[data-testid="localscope-devices"]').exists()).toBe(true)
    expect(w.text()).toContain('1 connected')
  })

  // iOS simulators are collected; the page must not claim otherwise.
  it('does not claim iOS is uncollected', async () => {
    const w = await mountPage({
      devices: {
        items: [{ ...device, id: 'ios:X', platform: 'ios', form: 'simulator', model: 'iPhone 17', osVersion: 'iOS 26.5' }],
        connected: 1,
      },
    })
    expect(w.text()).toContain('iPhone 17')
    expect(w.text()).not.toContain('iOS simulators — not collected yet')
  })
})
