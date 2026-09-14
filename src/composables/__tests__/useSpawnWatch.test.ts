import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPAWN_STATUS_POLL_MS } from '../../utils/sse'
import { __resetSpawnWatch, answerFolderTrust, forgetSpawn, openFolderTrust, useSpawnWatch, watchSpawn } from '../useSpawnWatch'

/*
 * 3M.1: the spawn watch no longer decides whether Claude is waiting at its
 * folder trust question — the server does, in the agents stream. What is left
 * is the dialog's bounded status read and the user's answer requests.
 */

let statusBody: Record<string, unknown>
let fetchMock: ReturnType<typeof vi.fn>
const calls = (match: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(match))
const tick = (ms = SPAWN_STATUS_POLL_MS) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => {
  vi.useFakeTimers()
  statusBody = { status: 'running' }
  fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).endsWith('/folder-trust') ? { ok: true } : statusBody) }))
  vi.stubGlobal('fetch', fetchMock)
  __resetSpawnWatch()
})

afterEach(() => {
  __resetSpawnWatch()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSpawnWatch (3M.1)', () => {
  // P
  it('runs no timer and makes no request while nothing is watched', async () => {
    useSpawnWatch()
    await tick(60_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  // P: a trust question no longer extends browser polling — the server owns it.
  it('stops after a bounded number of status reads, even if Claude is waiting at its trust question', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: { path: '/w', selected: 'exit' } }
    watchSpawn(1, '/w')
    await tick(SPAWN_STATUS_POLL_MS * 60)
    expect(calls('/status').length).toBe(15)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports an exit and stops', async () => {
    const { spawns } = useSpawnWatch()
    watchSpawn(2, '/w')
    statusBody = { status: 'exited', exitCode: null }
    await tick()
    expect(spawns.value[0].status).toBe('exited')
    expect(spawns.value[0].error).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  // M
  it('never sends a trust answer on its own', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: { path: '/w', selected: 'exit' } }
    watchSpawn(3, '/w')
    await tick(SPAWN_STATUS_POLL_MS * 20)
    expect(calls('/folder-trust')).toHaveLength(0)
  })

  it('sends exactly the decision the user made, then reads the status again to see what Claude did', async () => {
    watchSpawn(4, '/w')
    await tick(SPAWN_STATUS_POLL_MS * 20)
    const before = calls('/status').length
    await answerFolderTrust(4, 'exit')
    const [url, init] = calls('/folder-trust')[0]
    expect(url).toBe('/api/agents/spawn/4/folder-trust')
    expect(JSON.parse(init.body)).toEqual({ decision: 'exit' })
    statusBody = { status: 'exited', exitCode: null }
    await tick()
    expect(calls('/status').length).toBe(before + 1)
    expect(useSpawnWatch().spawns.value[0].status).toBe('exited')
  })

  // J (client side): a refused answer is shown, not assumed delivered.
  it('shows the server refusing a second answer', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({ error: 'This folder trust question was already answered' }) }))
    await answerFolderTrust(5, 'trust')
    expect(useSpawnWatch().answerStateFor(5)).toEqual({ answering: false, error: 'This folder trust question was already answered' })
  })

  it('works for a question this browser did not start (after a reload or from another tab)', async () => {
    openFolderTrust(99)
    expect(useSpawnWatch().focusedTrustPid.value).toBe(99)
    await answerFolderTrust(99, 'trust')
    expect(calls('/folder-trust')[0][0]).toBe('/api/agents/spawn/99/folder-trust')
    forgetSpawn(99)
    expect(useSpawnWatch().focusedTrustPid.value).toBeNull()
  })
})
