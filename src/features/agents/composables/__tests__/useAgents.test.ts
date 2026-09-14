import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'

// Minimal EventSource stub to prevent actual network calls.
class MockEventSource {
  static instances: MockEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  readyState = 0

  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }

  close() {
    this.readyState = 2
  }
}

// Provide a minimal localStorage stub.
const store: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
  length: 0,
  key: () => null,
}

let useAgents: typeof import('../useAgents')

beforeEach(async () => {
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([]),
  }))
  vi.resetModules()
  useAgents = await import('../useAgents')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Helper: mount a wrapper component to provide the Vue lifecycle context
 * that composables using onUnmounted require.
 */
function withSetup<T>(composable: () => T) {
  let result!: T
  const Wrapper = defineComponent({
    setup() {
      result = composable()
      return {}
    },
    template: '<div />',
  })
  const wrapper = mount(Wrapper, { attachTo: document.body })
  return { result, wrapper }
}

describe('useAgents', () => {
  it('initialises with an agents ref', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: false }))
    expect(result.agents).toBeDefined()
    expect(Array.isArray(result.agents.value)).toBe(true)
    wrapper.unmount()
  })

  it('exposes filteredAgents and searchQuery refs', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: false }))
    expect(result.filteredAgents).toBeDefined()
    expect(result.searchQuery).toBeDefined()
    wrapper.unmount()
  })

  it('creates an EventSource connection when autoStart is true', async () => {
    const { wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await nextTick()
    // SSE connection must be established after the first tick.
    expect(MockEventSource.instances.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('selectAgent updates selectedAgent', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: false }))
    // Set a non-null value first, then clear it to verify null assignment works.
    // Note: Vue wraps objects in a Proxy, so use toStrictEqual rather than toBe.
    const fakeAgent = { sessionId: 'test' } as any
    result.selectAgent(fakeAgent)
    expect(result.selectedAgent.value).toStrictEqual(fakeAgent)
    result.selectAgent(null)
    expect(result.selectedAgent.value).toBeNull()
    wrapper.unmount()
  })

  // A caller passing autoStart: false never increments the shared subscriber
  // count, so it must not decrement it on unmount either — only a caller that
  // started the stream may stop it. DashboardView mounts/unmounts on every
  // dashboard<->other-view switch; without this, two switches away from
  // Dashboard silently close the stream for every other consumer (e.g. App.vue).
  it('a caller opted out of owning the stream (autoStart: false) does not tear it down for an owner on repeated mount/unmount', async () => {
    const owner = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await nextTick()
    expect(MockEventSource.instances).toHaveLength(1)
    const es = MockEventSource.instances[0]
    expect(es.readyState).not.toBe(2)

    withSetup(() => useAgents.useAgents({ autoStart: false })).wrapper.unmount()
    withSetup(() => useAgents.useAgents({ autoStart: false })).wrapper.unmount()

    expect(es.readyState).not.toBe(2)
    owner.wrapper.unmount()
  })
})

describe('useAgents pendingCapabilityDecisions', () => {
  it('a poll response (no decisions field) leaves the pending list untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }))
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: false }))
    result.pendingCapabilityDecisions.value = [{ id: 'cap-1' } as any]

    result.startStream()
    await flushPromises()

    expect(result.pendingCapabilityDecisions.value).toEqual([{ id: 'cap-1' }])
    wrapper.unmount()
  })

  it('an SSE frame without the field clears the pending list', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    result.pendingCapabilityDecisions.value = [{ id: 'cap-1' } as any]

    const es = MockEventSource.instances[0]
    es.onmessage?.({ data: JSON.stringify({ agents: [], trend: [] }) } as MessageEvent)

    expect(result.pendingCapabilityDecisions.value).toEqual([])
    wrapper.unmount()
  })
})

// 3M.1 D + E + F: pending folder trust is server state carried in every stream
// frame, so any browser (a reloaded one, a second tab) rebuilds it from the stream.
describe('useAgents pendingFolderTrust', () => {
  it('takes the pending folder trust list from a stream frame', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    const es = MockEventSource.instances[0]
    es.onmessage?.({ data: JSON.stringify({ agents: [], trend: [], pendingFolderTrust: [{ pid: 7, path: '/w/untrusted', since: '2026-09-14T10:00:00Z' }] }) } as MessageEvent)
    expect(result.pendingFolderTrust.value).toEqual([{ pid: 7, path: '/w/untrusted', since: '2026-09-14T10:00:00Z' }])

    // Every consumer reads the same server-owned list.
    expect(useAgents.useAgents({ autoStart: false }).pendingFolderTrust.value).toHaveLength(1)

    es.onmessage?.({ data: JSON.stringify({ agents: [], trend: [], pendingFolderTrust: [] }) } as MessageEvent)
    expect(result.pendingFolderTrust.value).toEqual([])
    wrapper.unmount()
  })

  it('a poll response (no such field) leaves the pending list untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: false }))
    result.pendingFolderTrust.value = [{ pid: 8, path: '/w', since: '' }]
    result.startStream()
    await flushPromises()
    expect(result.pendingFolderTrust.value).toEqual([{ pid: 8, path: '/w', since: '' }])
    result.pendingFolderTrust.value = []
    wrapper.unmount()
  })
})

/*
 * B: `live` is what the shell's status line claims, so it has to follow the
 * feed itself. Before 3B.1 it was `!error`, and `error` is only set by a failed
 * request — a stream that dropped and was retrying by itself stayed "live"
 * indefinitely (seen in the running app: 45s offline, still live).
 */
describe('useAgents live', () => {
  const lastSource = () => MockEventSource.instances.at(-1)!
  const frame = { data: JSON.stringify({ agents: [], trend: [] }) } as MessageEvent

  it('is live once agent data has arrived', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    expect(result.live.value).toBe(true)
    wrapper.unmount()
  })

  it('stops being live when the stream errors, even while it retries by itself', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    lastSource().onerror?.({} as Event)
    expect(result.live.value).toBe(false)
    // A retrying stream is not a failed request to show the user.
    expect(result.error.value).toBeNull()
    lastSource().onmessage?.(frame)
    expect(result.live.value).toBe(true)
    wrapper.unmount()
  })

  it('is live again as soon as the stream reopens', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    lastSource().onerror?.({} as Event)
    lastSource().onopen?.()
    expect(result.live.value).toBe(true)
    wrapper.unmount()
  })

  it('is not live when the agents request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    expect(result.live.value).toBe(false)
    wrapper.unmount()
  })
})

describe('useAgents last-known data', () => {
  const lastSource = () => MockEventSource.instances.at(-1)!
  const frameWith = (agents: unknown[]) => ({ data: JSON.stringify({ agents, trend: [] }) } as MessageEvent)

  it('has no observation time until agent data arrives', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    expect(result.lastUpdatedAt.value).toBeNull()
    lastSource().onmessage?.(frameWith([]))
    expect(result.lastUpdatedAt.value).toEqual(expect.any(Number))
    wrapper.unmount()
  })

  // N: a dropped stream does not erase what was last observed.
  it('keeps the last agents while the stream reconnects', async () => {
    const { result, wrapper } = withSetup(() => useAgents.useAgents({ autoStart: true }))
    await flushPromises()
    lastSource().onmessage?.(frameWith([{ sessionId: 'kept', pid: 1, tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }, costEstimate: 0 }]))
    lastSource().onerror?.({} as Event)
    expect(result.live.value).toBe(false)
    expect(result.agents.value.map(a => a.sessionId)).toEqual(['kept'])
    wrapper.unmount()
  })
})
