import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { LocalScopeResponseError, LocalScopeUnreachableError } from '../../client'
import { createLocalScopeResource } from '../useLocalScopeResource'

function consumer(useResource: () => unknown) {
  return defineComponent({
    setup() {
      useResource()
      return {}
    },
    template: '<div />',
  })
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('createLocalScopeResource', () => {
  /*
   * The Phase 4 regression this factory exists to prevent: several components
   * each opening their own poller and bursting the endpoint.
   */
  it('issues one request when several components mount together', async () => {
    const fetcher = vi.fn(async () => ({ data: { ok: true } }))
    const useResource = createLocalScopeResource(fetcher)
    const C = consumer(useResource)
    const ws = [mount(C), mount(C), mount(C), mount(C)]
    await flush()

    expect(fetcher).toHaveBeenCalledTimes(1)
    ws.forEach(w => w.unmount())
  })

  it('shares the loaded value with a later consumer without refetching', async () => {
    const fetcher = vi.fn(async () => ({ data: { value: 42 } }))
    const useResource = createLocalScopeResource(fetcher)
    const C = consumer(useResource)
    const first = mount(C)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)

    const second = mount(C)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)

    first.unmount()
    second.unmount()
  })

  // "Not running" is an expected state for an optional collector, and must not
  // be presented as a failure.
  it('marks unreachable without setting an error when the collector is absent', async () => {
    const fetcher = vi.fn(async () => {
      throw new LocalScopeUnreachableError()
    })
    const useResource = createLocalScopeResource(fetcher as any)
    const C = consumer(useResource)
    const w = mount(C)
    await flush()

    const r = useResource()
    expect(r.reachable.value).toBe(false)
    expect(r.error.value).toBeNull()
    expect(r.data.value).toBeNull()
    w.unmount()
  })

  it('records a real collector failure as an error, still reachable', async () => {
    const fetcher = vi.fn(async () => {
      throw new LocalScopeResponseError(500)
    })
    const useResource = createLocalScopeResource(fetcher as any)
    const C = consumer(useResource)
    const w = mount(C)
    await flush()

    const r = useResource()
    expect(r.reachable.value).toBe(true)
    expect(r.error.value).toContain('500')
    w.unmount()
  })

  it('stops polling once the last consumer unmounts', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(async () => ({ data: 1 }))
    const useResource = createLocalScopeResource(fetcher, 1000)
    const C = consumer(useResource)
    const w = mount(C)
    await vi.advanceTimersByTimeAsync(2500)
    const during = fetcher.mock.calls.length
    expect(during).toBeGreaterThan(1)

    w.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher.mock.calls.length).toBe(during)
    vi.useRealTimers()
  })
})
