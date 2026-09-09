import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

let useSystemResources: typeof import('../useSystemResources').useSystemResources

function withSetup<T>(composable: () => T) {
  let result!: T
  const Wrapper = defineComponent({
    setup() {
      result = composable()
      return {}
    },
    template: '<div />',
  })
  const wrapper = mount(Wrapper)
  return { result, wrapper }
}

const mockSystemInfo = {
  cpu: { usage: 42, cores: 8, model: 'Apple M1' },
  memory: { total: 16e9, used: 8e9, available: 8e9, usagePercent: 50 },
  disk: { total: 500e9, used: 100e9, available: 400e9, usagePercent: 20, mount: '/' },
  loadAvg: [1.2, 1.5, 1.8],
  uptime: 3600,
}

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockSystemInfo),
    status: 200,
  }))
  // Prevent actual setInterval from running
  vi.useFakeTimers()
  vi.resetModules()
  const mod = await import('../useSystemResources')
  useSystemResources = mod.useSystemResources
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSystemResources', () => {
  it('fetches system info via refetch', async () => {
    const { result } = withSetup(() => useSystemResources())
    await result.refetch()
    expect(result.info.value?.cpu.usage).toBe(42)
    expect(result.info.value?.memory.usagePercent).toBe(50)
  })

  it('sets error on fetch failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    } as Response)
    vi.resetModules()
    const mod = await import('../useSystemResources')
    useSystemResources = mod.useSystemResources

    const { result } = withSetup(() => useSystemResources())
    await result.refetch()

    expect(result.error.value).toBeTruthy()
  })

  it('exposes info, error and refetch', () => {
    const { result } = withSetup(() => useSystemResources())
    expect(result.info).toBeDefined()
    expect(result.error).toBeDefined()
    expect(result.refetch).toBeTypeOf('function')
  })
})

/*
 * Regression guard for a 429 found in Phase 4 manual verification.
 *
 * This composable used to allocate fresh refs and its own interval per caller.
 * With one consumer that was invisible; once the status bar, the sidebar
 * machine card, the overview panel and the system map all wanted the same
 * numbers, four independent pollers hit /api/system on mount in the same tick,
 * the server's per-IP rate limiter answered 429, and every panel rendered
 * empty. State and the timer are now module-level and ref-counted.
 */
describe('useSystemResources — shared singleton', () => {
  const Consumer = defineComponent({
    setup() {
      useSystemResources()
      return {}
    },
    template: '<div />',
  })

  it('issues one request when several components mount together', async () => {
    const wrappers = [mount(Consumer), mount(Consumer), mount(Consumer), mount(Consumer)]
    await Promise.resolve()
    await Promise.resolve()

    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(1)
    wrappers.forEach(w => w.unmount())
  })

  it('shares one result set across consumers', async () => {
    const w = mount(Consumer)
    await Promise.resolve()
    await Promise.resolve()

    // A second consumer reads the value the first one already loaded.
    const { result } = withSetup(() => useSystemResources())
    expect(result.info.value?.cpu.model).toBe('Apple M1')
    w.unmount()
  })
})
