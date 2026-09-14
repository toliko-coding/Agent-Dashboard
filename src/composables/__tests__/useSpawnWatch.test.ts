import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPAWN_STATUS_POLL_MS } from '../../utils/sse'
import { __resetSpawnWatch, answerFolderTrust, forgetSpawn, useSpawnWatch, watchSpawn } from '../useSpawnWatch'

/*
 * The spawn-status watch behind New Agent (3M): the dialog's existing poll,
 * kept alive while Claude waits at its folder trust question, and the only
 * path by which a trust answer is sent — on an explicit call.
 */

const TRUST = { path: '/Users/me/scratch/plain', selected: 'exit' }
let statusBody: Record<string, unknown>
let fetchMock: ReturnType<typeof vi.fn>

const calls = (match: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(match))

async function tick(ms = SPAWN_STATUS_POLL_MS) {
  await vi.advanceTimersByTimeAsync(ms)
}

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

describe('useSpawnWatch', () => {
  // P
  it('runs no timer and makes no request while nothing is watched', async () => {
    useSpawnWatch()
    await tick(60_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops after the usual attempts when nothing needs the user', async () => {
    watchSpawn(1, '/tmp/a')
    await tick(SPAWN_STATUS_POLL_MS * 40)
    expect(calls('/status').length).toBe(15)
    expect(vi.getTimerCount()).toBe(0)
  })

  // N
  it('surfaces the trust question and keeps watching while it is open', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: TRUST }
    const { awaitingTrust } = useSpawnWatch()
    watchSpawn(7, TRUST.path)
    await tick(10)
    expect(awaitingTrust.value.map(s => [s.pid, s.folderTrust?.path])).toEqual([[7, TRUST.path]])
    expect(awaitingTrust.value[0].trustSince).not.toBeNull()
    await tick(SPAWN_STATUS_POLL_MS * 40)
    expect(calls('/status').length).toBeGreaterThan(15)
    expect(awaitingTrust.value).toHaveLength(1)
  })

  // M
  it('never answers the question on its own', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: TRUST }
    watchSpawn(7, TRUST.path)
    await tick(SPAWN_STATUS_POLL_MS * 30)
    expect(calls('/folder-trust')).toHaveLength(0)
  })

  it('sends exactly the decision the user made', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: TRUST }
    watchSpawn(7, TRUST.path)
    await tick(10)
    await answerFolderTrust(7, 'trust')
    const [url, init] = calls('/folder-trust')[0]
    expect(url).toBe('/api/agents/spawn/7/folder-trust')
    expect(JSON.parse(init.body)).toEqual({ decision: 'trust' })
  })

  // O
  it('declining ends in a stopped agent, with no question left and no timer running', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: TRUST }
    const { awaitingTrust, spawns } = useSpawnWatch()
    watchSpawn(7, TRUST.path)
    await tick(10)
    await answerFolderTrust(7, 'exit')
    statusBody = { status: 'exited', exitCode: null }
    await tick()
    expect(awaitingTrust.value).toEqual([])
    expect(spawns.value[0].status).toBe('exited')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows a refused answer instead of pretending it was delivered', async () => {
    statusBody = { status: 'running', awaitingFolderTrust: TRUST }
    const { spawns } = useSpawnWatch()
    watchSpawn(7, TRUST.path)
    await tick(10)
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({ error: 'Claude is not asking to trust a folder right now' }) }))
    await answerFolderTrust(7, 'trust')
    expect(spawns.value[0].error).toContain('not asking')
    forgetSpawn(7)
    expect(spawns.value).toEqual([])
  })
})
