import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Who polls what, proven against the REAL shared resources (3K).
 *
 *   N  Command's Runtime section starts no list poller.
 *   O  Runtime starts the snapshot and /api/system, plus only the list its
 *      open section shows; leaving a section stops its list.
 *   P  Two consumers of one source on a page are still one poller.
 *   M  The all-processes scan is one request per click and is never polled.
 *
 * Only setInterval/clearInterval are faked, and time advances one second at a
 * time with promises flushed in between, so a collapsed in-flight request can
 * not hide a duplicate poller.
 */

vi.mock('@/features/agents', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  const { ref } = await import('vue')
  return { ...real, useAgents: () => ({ agents: ref([]), lastUpdatedAt: ref(1) }) }
})
vi.mock('@/composables/useBuildVersion', async () => {
  const { ref } = await import('vue')
  return { useBuildVersion: () => ({ version: ref('dev') }) }
})

const SNAPSHOT = '/api/localscope/snapshot'
const SERVICES = '/api/localscope/services'
const PROCESSES = '/api/localscope/processes'
const DEVICES = '/api/localscope/devices'
const SYSTEM = '/api/system'
const SCAN = '/localscope/api/system/processes?all=true'

const FRESH = { source: 'ok', collectedAt: '2026-09-14T00:00:00Z', ageMs: 100, degraded: [] }
const BODIES: Record<string, unknown> = {
  [SNAPSHOT]: { ...FRESH, counts: { services: 0, processesRelevant: 0, processesTotal: 10, devices: 0, network: 0, projects: 0 } },
  [SERVICES]: { ...FRESH, items: [] },
  [PROCESSES]: { ...FRESH, items: [], total: 10 },
  [DEVICES]: { ...FRESH, items: [], connected: 0 },
  [SYSTEM]: { cpu: { usage: 1, cores: 1, model: 'x' }, memory: { usagePercent: 1, used: 1, total: 2, available: 1 }, disk: { usagePercent: 1, used: 1, total: 2, available: 1, mount: '/' }, loadAvg: [1], uptime: 1 },
  [SCAN]: { data: { processes: [], total: 10 }, degraded: [], collectedAt: '2026-09-14T00:00:00Z', durationMs: 1 },
  '/api/system/health': { version: 'dev' },
}

let fetchMock: ReturnType<typeof vi.fn>
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url) === path).length
const snapshotOfCalls = () => Object.fromEntries([SNAPSHOT, SERVICES, PROCESSES, DEVICES, SYSTEM, SCAN].map(p => [p, calls(p)]))

async function elapse(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 1000) {
    vi.advanceTimersByTime(1000)
    await flushPromises()
  }
}

async function mountRuntime(section: string) {
  vi.resetModules()
  localStorage.setItem('runtime-active-section', section)
  const RuntimeView = (await import('../RuntimeView.vue')).default
  const w = mount(RuntimeView)
  await flushPromises()
  return w
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  fetchMock = vi.fn(async (input: string) => ({ ok: true, status: 200, json: async () => BODIES[String(input)] ?? {} }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('command — runtime polling (N)', () => {
  it('reads only the snapshot from Command\'s Runtime section, and starts no list poller', async () => {
    vi.resetModules()
    const RuntimeSection = (await import('@/features/cockpit/components/RuntimeSection.vue')).default
    const w = mount(RuntimeSection, { props: { agents: [], liveAgentCount: 0 } })
    await flushPromises()
    await elapse(60_000)
    expect(calls(SNAPSHOT)).toBeGreaterThan(0)
    expect(calls(SERVICES)).toBe(0)
    expect(calls(PROCESSES)).toBe(0)
    expect(calls(DEVICES)).toBe(0)
    expect(calls(SCAN)).toBe(0)
    w.unmount()
  })
})

describe('runtime — pollers follow the open section (O)', () => {
  it('the Overview polls the snapshot and machine resources, and no list', async () => {
    const w = await mountRuntime('overview')
    await elapse(60_000)
    expect(calls(SNAPSHOT)).toBeGreaterThan(1)
    expect(calls(SYSTEM)).toBeGreaterThan(1)
    expect(calls(SERVICES)).toBe(0)
    expect(calls(PROCESSES)).toBe(0)
    expect(calls(DEVICES)).toBe(0)
    expect(calls(SCAN)).toBe(0)
    w.unmount()
  })

  it.each([
    ['services', SERVICES],
    ['processes', PROCESSES],
    ['devices', DEVICES],
  ])('the %s section polls only its own list', async (section, path) => {
    const w = await mountRuntime(section)
    await elapse(60_000)
    for (const other of [SERVICES, PROCESSES, DEVICES])
      expect(calls(other), other).toBe(other === path ? calls(path) : 0)
    expect(calls(path)).toBeGreaterThan(1)
    expect(calls(SYSTEM)).toBe(0)
    expect(calls(SCAN)).toBe(0)
    w.unmount()
  })

  it('the Workspaces section polls services and processes, not devices', async () => {
    const w = await mountRuntime('workspaces')
    await elapse(30_000)
    expect(calls(SERVICES)).toBeGreaterThan(1)
    expect(calls(PROCESSES)).toBeGreaterThan(1)
    expect(calls(DEVICES)).toBe(0)
    w.unmount()
  })

  it('leaving a section stops its list, and leaving Runtime stops everything', async () => {
    const w = await mountRuntime('services')
    await elapse(10_000)
    await w.get('[data-testid="runtime-nav-devices"]').trigger('click')
    await flushPromises()
    const servicesSoFar = calls(SERVICES)
    await elapse(60_000)
    expect(calls(SERVICES)).toBe(servicesSoFar)
    expect(calls(DEVICES)).toBeGreaterThan(1)

    w.unmount()
    const before = snapshotOfCalls()
    await elapse(120_000)
    expect(snapshotOfCalls()).toEqual(before)
  })
})

describe('runtime — one poller per source (P)', () => {
  it('the source line and the Overview share one snapshot poller', async () => {
    const w = await mountRuntime('overview')
    expect(calls(SNAPSHOT)).toBe(1)
    await elapse(40_000)
    // One load on mount, then one per 5s interval.
    expect(calls(SNAPSHOT)).toBe(1 + 8)
    // One load on mount, then one per 15s interval.
    expect(calls(SYSTEM)).toBe(1 + 2)
    w.unmount()
  })

  it('each list polls once per interval', async () => {
    const w = await mountRuntime('workspaces')
    expect(calls(SERVICES)).toBe(1)
    expect(calls(PROCESSES)).toBe(1)
    await elapse(40_000)
    expect(calls(SERVICES)).toBe(1 + 8)
    expect(calls(PROCESSES)).toBe(1 + 5)
    w.unmount()
  })
})

describe('runtime — the all-processes scan (M)', () => {
  it('is never requested until asked, then exactly once, and never polled', async () => {
    const w = await mountRuntime('processes')
    await elapse(30_000)
    expect(calls(SCAN)).toBe(0)

    await w.get('[data-testid="process-scan"]').trigger('click')
    await flushPromises()
    expect(calls(SCAN)).toBe(1)
    await elapse(120_000)
    expect(calls(SCAN)).toBe(1)
    w.unmount()
  })
})
