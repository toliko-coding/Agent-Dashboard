import type { WorkspaceRef } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import RuntimeDevices from '../RuntimeDevices.vue'
import RuntimeProcesses from '../RuntimeProcesses.vue'
import RuntimeServices from '../RuntimeServices.vue'

/*
 * Services, Processes and Devices on the Runtime page (3K), on the normalized
 * model. Migrated from the LocalScope page's tests and extended with what the
 * redesign adds: workspace attribution, a default row that carries no path,
 * command or PID, and the all-processes scan as an explicit one-off request.
 */

vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })

const state = vi.hoisted(() => ({
  services: null as any,
  processes: null as any,
  devices: null as any,
  loaded: true,
  scan: vi.fn(),
}))

vi.mock('@/features/localscope', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/localscope')>()
  const { ref } = await import('vue')
  return {
    ...real,
    useMachineServices: () => ({ data: ref(state.services), loaded: ref(state.loaded), refetch: async () => {} }),
    useMachineProcesses: () => ({ data: ref(state.processes), loaded: ref(state.loaded), refetch: async () => {} }),
    useMachineDevices: () => ({ data: ref(state.devices), loaded: ref(state.loaded), refetch: async () => {} }),
    scanAllProcesses: () => state.scan(),
  }
})

const SECRET_CWD = '/Users/x/secret-path'
const MAIN = { id: 'ws_main', name: 'Agent-Dashboard', kind: 'git-main', branch: 'main', repository: { id: 'repo_ad', name: 'Agent-Dashboard' } } as WorkspaceRef
const WT = { id: 'ws_wt', name: 'wt-2dg', kind: 'git-worktree', branch: 'tmp/verify', repository: { id: 'repo_ad', name: 'Agent-Dashboard' } } as WorkspaceRef

const discovered = {
  id: 'p1',
  name: 'guessed-folder-name',
  packageName: null,
  rootPath: SECRET_CWD,
  displayPath: '~/secret-path',
  manifest: 'package.json',
  git: { isRepo: true, branch: 'main' },
  repo: null,
  frameworks: ['vite'],
}

function service(over: Record<string, unknown> = {}) {
  return {
    id: '87234:5173',
    pid: 87234,
    port: 5173,
    address: '127.0.0.1',
    protocol: 'tcp',
    bindScope: 'loopback',
    ipVersion: 'ipv4',
    processName: 'node',
    command: 'node vite.js --port 5173 --secret-flag',
    cwd: SECRET_CWD,
    runtime: 'node',
    kind: 'vite',
    label: 'Vite Development Server',
    url: 'http://localhost:5173',
    discoveredProject: discovered,
    confidence: 'high',
    startedAt: null,
    workspace: MAIN,
    ...over,
  }
}

function proc(over: Record<string, unknown> = {}) {
  return {
    id: '87234',
    pid: 87234,
    ppid: 4411,
    name: 'node',
    command: 'node vite.js --port 5173 --secret-flag',
    cwd: SECRET_CWD,
    runtime: 'node',
    cpuPercent: 12.5,
    memoryBytes: 104857600,
    elapsedSeconds: 3600,
    startedAt: null,
    ports: [5173],
    relevanceReasons: ['runtime-match', 'listening'],
    discoveredProject: discovered,
    workspace: MAIN,
    ...over,
  }
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

function list(over: Record<string, unknown>) {
  return { source: 'ok', collectedAt: '2026-09-14T00:00:00Z', ageMs: 900, degraded: [], ...over }
}

beforeEach(() => {
  state.services = list({ items: [service({ id: 'b', port: 9999, workspace: null, label: 'HTTP server' }), service()] })
  state.processes = list({ items: [proc()], total: 818 })
  state.devices = list({ items: [device], connected: 1 })
  state.loaded = true
  state.scan = vi.fn()
})

describe('runtime services', () => {
  // 3N.2.2 P25–P32: a port opens its local service, from the validated port alone.
  describe('port links', () => {
    it('opens localhost for a loopback or all-interfaces TCP service, in a new tab, with its own name', () => {
      state.services = list({ items: [
        service({ id: 'v', port: 5173, protocol: 'tcp', bindScope: 'loopback', address: '127.0.0.1', url: 'http://localhost:5173' }),
        service({ id: 'n', port: 3000, protocol: 'tcp', bindScope: 'all', address: '0.0.0.0', url: null }),
        service({ id: 's', port: 3001, protocol: 'tcp', bindScope: 'all', address: '::', url: null }),
      ] })
      const links = mount(RuntimeServices).findAll('a[data-testid="service-port"]')
      expect(links.map(l => l.attributes('href'))).toEqual(['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'])
      const vite = links[2]
      expect(vite.attributes('target')).toBe('_blank')
      expect(vite.attributes('rel')).toBe('noopener noreferrer')
      expect(vite.attributes('aria-label')).toBe('Open localhost port 5173')
      expect(vite.text()).toBe(':5173')
    })

    it('never puts a service-supplied host or path into the link, and has no raw-url Open link', () => {
      state.services = list({ items: [service({ port: 5173, protocol: 'tcp', bindScope: 'loopback', url: 'http://evil.example:5173/x' })] })
      const w = mount(RuntimeServices)
      expect(w.get('[data-testid="service-port"]').attributes('href')).toBe('http://localhost:5173')
      expect(w.html()).not.toContain('evil.example')
      expect(w.find('[data-testid="service-open"]').exists()).toBe(false)
    })

    it('renders an invalid, non-TCP or non-local port as plain text', () => {
      state.services = list({ items: [
        service({ id: 'a', port: 70000, protocol: 'tcp', bindScope: 'loopback' }),
        service({ id: 'b', port: 5353, protocol: 'udp', bindScope: 'all' }),
        service({ id: 'c', port: 5432, protocol: 'tcp', bindScope: 'specific', address: '192.168.1.20' }),
      ] })
      const ports = mount(RuntimeServices).findAll('[data-testid="service-port"]')
      expect(ports).toHaveLength(3)
      for (const p of ports) {
        expect(p.element.tagName).toBe('SPAN')
        expect(p.attributes('href')).toBeUndefined()
      }
    })

    it('is a native link, so Tab reaches it and Enter opens it, and has no axe violations', async () => {
      state.services = list({ items: [service({ port: 5173, protocol: 'tcp', bindScope: 'loopback' })] })
      const w = mount(RuntimeServices, { attachTo: document.body })
      const link = w.get('[data-testid="service-port"]').element as HTMLAnchorElement
      link.focus()
      expect(document.activeElement).toBe(link)
      expect(link.tagName).toBe('A')
      expect(link.getAttribute('tabindex')).toBeNull()
      expect(await axe(w.element as Element)).toHaveNoViolations()
      w.unmount()
    })
  })

  // I
  it('lists services by port with name, runtime, count and workspace', () => {
    const w = mount(RuntimeServices)
    const rows = w.findAll('[data-testid="service-row"]')
    expect(rows.map(r => r.get('[data-testid="service-port"]').text())).toEqual([':5173', ':9999'])
    expect(rows[0].text()).toContain('Vite Development Server')
    expect(rows[0].text()).toContain('node')
    expect(w.get('[data-testid="services-count"]').text()).toBe('2 listening')
    const label = rows[0].get('[data-testid="runtime-workspace"]')
    expect(label.attributes('data-workspace-id')).toBe('ws_main')
    expect(label.text()).toContain('Agent-Dashboard')
    expect(label.text()).toContain('main checkout')
  })

  it('names a worktree by its branch and kind', () => {
    state.services = list({ items: [service({ workspace: WT })] })
    const label = mount(RuntimeServices).get('[data-testid="runtime-workspace"]')
    expect(label.text()).toContain('tmp/verify')
    expect(label.text()).toContain('worktree')
  })

  // G
  it('says Workspace unknown for an unattributed service, and never guesses from its folder', () => {
    const row = mount(RuntimeServices).findAll('[data-testid="service-row"]')[1]
    expect(row.get('[data-testid="runtime-workspace-unknown"]').text()).toBe('Workspace unknown')
    expect(row.text()).not.toContain('guessed-folder-name')
    expect(row.text()).not.toContain('Agent-Dashboard')
  })

  // H
  it('shows no cwd, project path or command line — not even in Details', async () => {
    const w = mount(RuntimeServices)
    for (const forbidden of [SECRET_CWD, '~/secret-path', 'vite.js', '--secret-flag', '87234'])
      expect(w.html(), forbidden).not.toContain(forbidden)

    const toggle = w.findAll('[data-testid="service-details-toggle"]')[0]
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    const details = w.get('[data-testid="service-details"]')
    expect(details.attributes('id')).toBe(toggle.attributes('aria-controls'))
    expect(details.text()).toContain('127.0.0.1:5173')
    expect(details.text()).toContain('pid 87234')
    for (const forbidden of [SECRET_CWD, '~/secret-path', 'vite.js', '--secret-flag'])
      expect(w.html(), forbidden).not.toContain(forbidden)
  })

  it('says a runtime LocalScope did not identify in words, not as a bare "unknown"', () => {
    state.services = list({ items: [service({ runtime: 'unknown' })] })
    expect(mount(RuntimeServices).get('[data-testid="service-runtime"]').text()).toBe('runtime not identified')
    state.processes = list({ items: [proc({ runtime: 'unknown' })], total: 1 })
    expect(mount(RuntimeProcesses).get('[data-testid="process-runtime"]').text()).toBe('runtime not identified')
  })

  it('marks an inferred classification as a guess', () => {
    state.services = list({ items: [service({ confidence: 'low' })] })
    expect(mount(RuntimeServices).get('[data-testid="service-guess"]').text()).toBe('guess')
  })

  // Bound to all interfaces is reachable from the network: a security-relevant fact, in words.
  it('warns when a service is bound to all interfaces', async () => {
    state.services = list({ items: [service({ bindScope: 'all' })] })
    const w = mount(RuntimeServices)
    const flag = w.get('[data-testid="service-all-interfaces"]')
    expect(flag.classes()).toContain('text-warning-text')
    expect(flag.text()).toContain('reachable from your network')
    await w.get('[data-testid="service-details-toggle"]').trigger('click')
    expect(w.get('[data-testid="service-scope"]').text()).toContain('all interfaces')
  })

  it('an unknown list is not an empty one, and neither is loading', () => {
    state.services = list({ source: 'unavailable', items: null })
    const unknown = mount(RuntimeServices)
    expect(unknown.find('[data-testid="services-unknown"]').exists()).toBe(true)
    expect(unknown.text()).not.toContain('No listening development services')
    expect(unknown.find('[data-testid="services-count"]').exists()).toBe(false)

    state.services = list({ items: [] })
    const empty = mount(RuntimeServices)
    expect(empty.find('[data-testid="services-none"]').exists()).toBe(true)
    expect(empty.get('[data-testid="services-count"]').text()).toBe('0 listening')

    state.services = list({ source: 'unavailable', items: null })
    state.loaded = false
    expect(mount(RuntimeServices).find('[data-testid="services-loading"]').exists()).toBe(true)
  })

  // B
  it('keeps a stale list visible and marks it stale', () => {
    state.services = list({ source: 'stale', ageMs: 185_000, items: [service()] })
    const w = mount(RuntimeServices)
    expect(w.findAll('[data-testid="service-row"]')).toHaveLength(1)
    expect(w.get('[data-testid="services-freshness"]').text()).toContain('stale · 3m ago')
  })

  it('marks a degraded list as partial rather than healthy', () => {
    state.services = list({ source: 'degraded', degraded: [{ source: 'lsof', reason: 'x', kind: 'partial' }], items: [service()] })
    expect(mount(RuntimeServices).get('[data-testid="services-freshness"]').text()).toContain('partial · lsof')
  })

  // R
  it('has no axe violations, with details open', async () => {
    state.services = list({ items: [service({ bindScope: 'all', confidence: 'low' }), service({ id: 'b', port: 9999, workspace: null })] })
    const w = mount(RuntimeServices, { attachTo: document.body })
    await w.findAll('[data-testid="service-details-toggle"]')[0].trigger('click')
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})

describe('runtime processes', () => {
  // J
  it('lists name, runtime, ports, workspace, CPU and memory, with the denominator', () => {
    const w = mount(RuntimeProcesses)
    const row = w.get('[data-testid="process-row"]')
    expect(row.text()).toContain('node')
    expect(row.get('[data-testid="process-ports"]').text()).toContain(':5173')
    expect(row.get('[data-testid="runtime-workspace"]').attributes('data-workspace-id')).toBe('ws_main')
    expect(row.get('[data-testid="process-usage"]').text()).toContain('12.5% CPU')
    expect(row.get('[data-testid="process-usage"]').text()).toContain('100 MB')
    expect(w.get('[data-testid="processes-count"]').text()).toBe('1 of 818')
  })

  it('shows CPU and memory only when reported, never as zero', () => {
    state.processes = list({ items: [proc({ cpuPercent: null, memoryBytes: null })], total: null })
    const w = mount(RuntimeProcesses)
    expect(w.find('[data-testid="process-usage"]').exists()).toBe(false)
    expect(w.get('[data-testid="process-row"]').text()).not.toMatch(/0(?:\.0)?% CPU|\b0 MB/)
    expect(w.get('[data-testid="processes-count"]').text()).toBe('1 developer')
  })

  // H
  it('keeps PID and command line behind Details, and never shows the working directory', async () => {
    const w = mount(RuntimeProcesses)
    for (const forbidden of [SECRET_CWD, 'vite.js', '--secret-flag', '87234', '~/secret-path'])
      expect(w.html(), forbidden).not.toContain(forbidden)

    await w.get('[data-testid="process-details-toggle"]').trigger('click')
    const details = w.get('[data-testid="process-details"]')
    expect(details.text()).toContain('87234 · parent 4411')
    expect(details.text()).toContain('1h 0m')
    expect(w.get('[data-testid="process-relevance"]').text()).toBe('Known development runtime · Listening service')
    expect(w.get('[data-testid="process-command"]').text()).toContain('node vite.js --port 5173')
    expect(w.html()).not.toContain(SECRET_CWD)
    expect(w.html()).not.toContain('~/secret-path')
  })

  it('an unknown list is not an empty one', () => {
    state.processes = list({ source: 'unavailable', items: null, total: null })
    const unknown = mount(RuntimeProcesses)
    expect(unknown.find('[data-testid="processes-unknown"]').exists()).toBe(true)
    expect(unknown.find('[data-testid="processes-list"]').exists()).toBe(false)
    state.processes = list({ items: [], total: 700 })
    expect(mount(RuntimeProcesses).find('[data-testid="processes-none"]').exists()).toBe(true)
  })

  it('keeps a stale list visible and marks it stale', () => {
    state.processes = list({ source: 'stale', ageMs: 120_000, items: [proc()], total: 818 })
    const w = mount(RuntimeProcesses)
    expect(w.findAll('[data-testid="process-row"]')).toHaveLength(1)
    expect(w.get('[data-testid="processes-freshness"]').text()).toContain('stale · 2m ago')
  })

  // M
  it('runs the all-processes scan only when asked, once, and never refreshes it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'clearInterval', 'clearTimeout'] })
    const many = Array.from({ length: 75 }, (_, i) => proc({ id: `s${i}`, pid: 1000 + i, name: `proc-${i}`, workspace: null }))
    state.scan.mockResolvedValue({ items: many, total: 906, takenAt: Date.UTC(2026, 8, 14, 12, 0, 0) })
    const w = mount(RuntimeProcesses)
    expect(state.scan).not.toHaveBeenCalled()

    await w.get('[data-testid="process-scan"]').trigger('click')
    await flushPromises()
    expect(state.scan).toHaveBeenCalledTimes(1)
    const banner = w.get('[data-testid="process-scan-result"]')
    expect(banner.text()).toContain('Diagnostic scan')
    expect(banner.text()).toContain('not refreshed')
    expect(w.get('[data-testid="processes-count"]').text()).toBe('75 of 906')
    expect(w.findAll('[data-testid="process-row"]')).toHaveLength(60)
    expect(w.get('[data-testid="processes-render-cap"]').text()).toContain('15 more not rendered')
    expect(w.find('[data-testid="processes-freshness"]').exists()).toBe(false)
    // Scan rows carry no workspace identity, and say so.
    expect(w.findAll('[data-testid="runtime-workspace-unknown"]').length).toBe(60)

    vi.advanceTimersByTime(10 * 60_000)
    await flushPromises()
    expect(state.scan).toHaveBeenCalledTimes(1)

    await w.get('[data-testid="process-scan-rescan"]').trigger('click')
    await flushPromises()
    expect(state.scan).toHaveBeenCalledTimes(2)

    await w.get('[data-testid="process-scan-close"]').trigger('click')
    expect(w.find('[data-testid="process-scan-result"]').exists()).toBe(false)
    expect(w.findAll('[data-testid="process-row"]')).toHaveLength(1)
    vi.useRealTimers()
  })

  it('says so when the scan fails, and keeps the developer processes', async () => {
    state.scan.mockRejectedValue(new Error('unreachable'))
    const w = mount(RuntimeProcesses)
    await w.get('[data-testid="process-scan"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="process-scan-error"]').text()).toContain('did not complete')
    expect(w.findAll('[data-testid="process-row"]')).toHaveLength(1)
  })

  it('has no axe violations, with details open', async () => {
    const w = mount(RuntimeProcesses, { attachTo: document.body })
    await w.get('[data-testid="process-details-toggle"]').trigger('click')
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})

describe('runtime devices', () => {
  const stateOf = (w: ReturnType<typeof mount>) => w.get('[data-testid="runtime-devices"]').attributes('data-state')

  // K
  it('lists devices with their count and state in words', () => {
    const w = mount(RuntimeDevices)
    expect(stateOf(w)).toBe('measured')
    expect(w.get('[data-testid="devices-count"]').text()).toBe('1 connected')
    const row = w.get('[data-testid="device-row"]')
    expect(row.text()).toContain('sdk gphone64 arm64')
    expect(row.text()).toContain('android · emulator · Android 13')
    expect(row.get('[data-testid="device-state"]').text()).toBe('online')
  })

  it('a measured zero reads zero', () => {
    state.devices = list({ items: [], connected: 0 })
    const w = mount(RuntimeDevices)
    expect(stateOf(w)).toBe('measured')
    expect(w.find('[data-testid="devices-none"]').exists()).toBe(true)
    expect(w.get('[data-testid="devices-count"]').text()).toBe('0 connected')
  })

  it('an unknown device list is not an empty one', () => {
    state.devices = list({ source: 'unavailable', items: null, connected: null })
    const w = mount(RuntimeDevices)
    expect(stateOf(w)).toBe('unknown')
    expect(w.find('[data-testid="devices-unknown"]').exists()).toBe(true)
    expect(w.find('[data-testid="devices-none"]').exists()).toBe(false)
    expect(w.text()).not.toContain('0 connected')
  })

  it('adapters that could not run read differently from zero devices', () => {
    state.devices = list({ source: 'degraded', items: [], connected: null, degraded: [{ source: 'adb', reason: 'adb is not on PATH', kind: 'missing' }] })
    const w = mount(RuntimeDevices)
    expect(stateOf(w)).toBe('adapters-failed')
    const note = w.get('[data-testid="devices-unavailable"]')
    expect(note.text()).toContain('(adb)')
    expect(note.text()).toContain('not the same as zero devices')
    expect(w.find('[data-testid="devices-none"]').exists()).toBe(false)
    expect(w.find('[data-testid="devices-count"]').exists()).toBe(false)
  })

  it('devices found while another adapter failed are shown, as possibly incomplete', () => {
    state.devices = list({
      source: 'degraded',
      items: [{ ...device, id: 'ios:X', platform: 'ios', form: 'simulator', model: 'iPhone 17', osVersion: 'iOS 26.5' }],
      connected: null,
      degraded: [{ source: 'adb', reason: 'adb is not on PATH', kind: 'missing' }],
    })
    const w = mount(RuntimeDevices)
    expect(stateOf(w)).toBe('incomplete')
    expect(w.text()).toContain('iPhone 17')
    expect(w.get('[data-testid="devices-incomplete"]').text()).toContain('may be incomplete')
    expect(w.find('[data-testid="devices-unavailable"]').exists()).toBe(false)
    expect(w.find('[data-testid="devices-count"]').exists()).toBe(false)
  })

  it('a partial adapter still counts, and is marked partial', () => {
    state.devices = list({ source: 'degraded', items: [device], connected: 1, degraded: [{ source: 'simctl', reason: '30 runtimes unavailable', kind: 'partial' }] })
    const w = mount(RuntimeDevices)
    expect(stateOf(w)).toBe('measured')
    expect(w.get('[data-testid="devices-count"]').text()).toBe('1 connected')
    expect(w.get('[data-testid="devices-freshness"]').text()).toContain('partial · simctl')
  })

  it('keeps stale devices visible and marks them stale', () => {
    state.devices = list({ source: 'stale', ageMs: 185_000, items: [device], connected: 1 })
    const w = mount(RuntimeDevices)
    expect(w.text()).toContain('sdk gphone64 arm64')
    expect(w.get('[data-testid="devices-freshness"]').text()).toContain('stale · 3m ago')
  })

  it('has no axe violations', async () => {
    state.devices = list({ items: [device, { ...device, id: 'u', model: null, state: 'unauthorized' }], connected: 2 })
    const w = mount(RuntimeDevices, { attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
