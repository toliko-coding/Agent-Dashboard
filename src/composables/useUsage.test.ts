import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

const mockNobudget = {
  windows: [
    { key: '5h', tokens: 2_100_000, costCents: 430, budgetTokens: null, pct: null },
    { key: '7d', tokens: 14_000_000, costCents: 2900, budgetTokens: null, pct: null },
  ],
  accounts: [],
}

const mockWithBudget = {
  windows: [
    { key: '5h', tokens: 1_000_000, costCents: 100, budgetTokens: 10_000_000, pct: 0.1 },
    { key: '7d', tokens: 5_000_000, costCents: 500, budgetTokens: 10_000_000, pct: 0.5 },
  ],
  accounts: [],
}

describe('useUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockNobudget),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('fetches on start and polls every 5 min', async () => {
    const { useUsage } = await import('./useUsage')
    const Host = defineComponent({
      setup() {
        const u = useUsage()
        u.start()
        return u
      },
      template: '<div />',
    })
    const w = mount(Host)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)

    w.unmount()
  })

  it('clears interval on unmount', async () => {
    const { useUsage } = await import('./useUsage')
    const Host = defineComponent({
      setup() {
        const u = useUsage()
        u.start()
        return u
      },
      template: '<div />',
    })
    const w = mount(Host)
    await flushPromises()
    w.unmount()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(1) // only the initial fetch
  })

  it('normalizes a single-account response (no accounts key) to an empty array', async () => {
    // Single-account server omits the accounts key entirely (json:"accounts,omitempty").
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ windows: mockWithBudget.windows }),
    }))
    vi.resetModules()
    const { useUsage } = await import('./useUsage')
    const Host = defineComponent({
      setup() {
        const u = useUsage()
        u.start()
        return u
      },
      template: '<div />',
    })
    const w = mount(Host)
    await flushPromises()
    expect((w.vm as any).data.accounts).toEqual([])
    w.unmount()
  })
})

describe('useUsage — shared (3N)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(mockNobudget) }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('lets a second reader see the starter\'s response without a request of its own', async () => {
    const { useUsage } = await import('./useUsage')
    const Starter = defineComponent({ setup: () => {
      const u = useUsage()
      u.start()
      return u
    }, template: '<div />' })
    const Reader = defineComponent({ setup: () => useUsage(), template: '<div />' })
    const a = mount(Starter)
    const b = mount(Reader)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((b.vm as any).data.windows).toHaveLength(2)
    b.unmount()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(fetch).toHaveBeenCalledTimes(2)
    a.unmount()
  })

  it('reports a failed read and keeps the previous reading', async () => {
    const { useUsage } = await import('./useUsage')
    const Host = defineComponent({ setup: () => {
      const u = useUsage()
      u.start()
      return u
    }, template: '<div />' })
    const w = mount(Host)
    await flushPromises()
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) } as Response)
    await (w.vm as any).refresh()
    expect((w.vm as any).error).toBe('Usage could not be read (503)')
    expect((w.vm as any).data.windows).toHaveLength(2)
    w.unmount()
  })
})
