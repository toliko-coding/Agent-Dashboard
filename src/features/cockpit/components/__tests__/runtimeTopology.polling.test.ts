import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The polling contract, proven against the REAL normalized list resources — not
 * a mock of them. The Overview is the landing page, and the service and process
 * lists were deliberately kept off always-open surfaces, so Runtime topology
 * must not start either poller until the user explicitly expands it.
 *
 * Only setInterval/clearInterval are faked, so promise settling stays real and
 * the resources' own interval is what the tests advance.
 */

const STORAGE_KEY = 'system-map-topology-expanded'
const SERVICES = '/api/localscope/services'
const PROCESSES = '/api/localscope/processes'
const LIST_BODY = { source: 'ok', collectedAt: null, ageMs: null, degraded: [], items: [], total: null }

function makeFetch() {
  return vi.fn(async (_input: string) => ({ ok: true, json: async () => LIST_BODY }))
}
let fetchMock: ReturnType<typeof makeFetch>

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

function calls(path: string): number {
  return fetchMock.mock.calls.filter(([url]) => String(url) === path).length
}

async function mountTopology() {
  // Fresh module state, so each case starts with both resources stopped.
  vi.resetModules()
  const RuntimeTopology = (await import('../RuntimeTopology.vue')).default
  const w = mount(RuntimeTopology, { props: { agents: [] } })
  await flushPromises()
  return w
}

async function elapse(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await flushPromises()
}

const toggleOf = (w: Awaited<ReturnType<typeof mountTopology>>) => w.get('[data-testid="runtime-topology-toggle"]')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.stubGlobal('localStorage', memoryStorage())
  fetchMock = makeFetch()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runtime topology — list polling', () => {
  // A + B
  it('is collapsed with no stored preference and starts neither list poller', async () => {
    const w = await mountTopology()
    expect(toggleOf(w).attributes('aria-expanded')).toBe('false')
    expect(w.find('[data-testid="runtime-topology-tree"]').exists()).toBe(false)

    await elapse(60_000)
    expect(calls(SERVICES)).toBe(0)
    expect(calls(PROCESSES)).toBe(0)
    // A first visit records no preference of its own.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    w.unmount()
  })

  // C
  it('opens from a stored expanded preference and polls both lists', async () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    const w = await mountTopology()
    expect(toggleOf(w).attributes('aria-expanded')).toBe('true')
    expect(w.find('[data-testid="runtime-topology-tree"]').exists()).toBe(true)

    // Each list loads once on mount…
    expect(calls(SERVICES)).toBe(1)
    expect(calls(PROCESSES)).toBe(1)
    // …and keeps polling on its own interval.
    await elapse(20_000)
    expect(calls(SERVICES)).toBeGreaterThanOrEqual(2)
    expect(calls(PROCESSES)).toBeGreaterThanOrEqual(2)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    w.unmount()
  })

  // D
  it('stays collapsed from a stored collapsed preference and polls nothing', async () => {
    localStorage.setItem(STORAGE_KEY, 'false')
    const w = await mountTopology()
    expect(toggleOf(w).attributes('aria-expanded')).toBe('false')

    await elapse(60_000)
    expect(calls(SERVICES)).toBe(0)
    expect(calls(PROCESSES)).toBe(0)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
    w.unmount()
  })

  // E
  it('starts polling when expanded manually, and remembers the choice', async () => {
    const w = await mountTopology()
    expect(calls(SERVICES)).toBe(0)

    await toggleOf(w).trigger('click')
    await flushPromises()
    expect(toggleOf(w).attributes('aria-expanded')).toBe('true')
    expect(calls(SERVICES)).toBe(1)
    expect(calls(PROCESSES)).toBe(1)

    await elapse(20_000)
    expect(calls(SERVICES)).toBeGreaterThanOrEqual(2)
    expect(calls(PROCESSES)).toBeGreaterThanOrEqual(2)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    w.unmount()
  })

  // F
  it('stops polling when collapsed manually', async () => {
    localStorage.setItem(STORAGE_KEY, 'true')
    const w = await mountTopology()
    await elapse(20_000)

    await toggleOf(w).trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="runtime-topology-tree"]').exists()).toBe(false)
    const services = calls(SERVICES)
    const processes = calls(PROCESSES)

    await elapse(120_000)
    expect(calls(SERVICES)).toBe(services)
    expect(calls(PROCESSES)).toBe(processes)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
    w.unmount()
  })
})
