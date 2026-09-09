import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Regression guard for a request storm.
 *
 * Every agent card carries a PromptInput, so opening the roster mounts several
 * at once. The cache stored only the resolved value, so simultaneous callers
 * all missed it and each issued its own /api/slash-commands request — enough
 * concurrent requests to trip the server's per-IP rate limiter (seen as four
 * 429s in browser verification). The cache now holds the in-flight promise.
 */
async function load() {
  vi.resetModules()
  return await import('../useSlashCommands')
}

describe('fetchDynamicCommands caching', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('issues one request for simultaneous callers with the same scope', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ commands: [{ name: 'deploy', description: 'ship it' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { fetchDynamicCommands } = await load()
    const scope = { sessionId: 's1' }
    const results = await Promise.all([
      fetchDynamicCommands(scope),
      fetchDynamicCommands(scope),
      fetchDynamicCommands(scope),
      fetchDynamicCommands(scope),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const r of results)
      expect(r.commands.map(c => c.name)).toEqual(['deploy'])
  })

  it('still issues one request per distinct scope', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ commands: [] }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { fetchDynamicCommands } = await load()
    await Promise.all([
      fetchDynamicCommands({ sessionId: 'a' }),
      fetchDynamicCommands({ sessionId: 'b' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // A 429 must not be cached as "this session has no commands" forever.
  it('does not cache a failed response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ commands: [{ name: 'later', description: 'd' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchDynamicCommands } = await load()
    const first = await fetchDynamicCommands({ sessionId: 's' })
    expect(first.commands).toEqual([])

    const second = await fetchDynamicCommands({ sessionId: 's' })
    expect(second.commands.map(c => c.name)).toEqual(['later'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a network error', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ commands: [{ name: 'ok', description: 'd' }] }) })
    vi.stubGlobal('fetch', fetchMock)

    const { fetchDynamicCommands } = await load()
    expect((await fetchDynamicCommands({ sessionId: 'n' })).commands).toEqual([])
    expect((await fetchDynamicCommands({ sessionId: 'n' })).commands.map(c => c.name)).toEqual(['ok'])
  })
})
