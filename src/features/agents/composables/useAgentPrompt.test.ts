import type { Agent } from '@/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addPending } from '@/utils/pendingMessages'
import { SW_READY_TIMEOUT_MS } from '@/utils/timing'
import { useAgentPrompt } from './useAgentPrompt'

vi.mock('@/utils/pendingMessages', () => ({ addPending: vi.fn(async () => {}) }))

function makeAgent(over: Partial<Agent> = {}): Agent {
  return {
    sessionId: 's1',
    pid: 123,
    cwd: '/projects/x',
    status: 'active',
    channelAvailable: false,
    ...over,
  } as Agent
}

describe('useAgentPrompt routing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  })

  it('injects live when liveInjectable — even when status is idle', async () => {
    const agent = makeAgent({ liveInjectable: true, status: 'idle' })
    const { promptInput, handleSend } = useAgentPrompt(() => agent)
    promptInput.value = 'hello'
    await handleSend()
    expect(fetch).toHaveBeenCalledWith(
      '/api/agents/123/message',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('does NOT fetch and does NOT call onMessageSent when !liveInjectable — sets resumeConfirm instead', async () => {
    const agent = makeAgent({ channelAvailable: false, liveInjectable: false, status: 'active' })
    const onMessageSent = vi.fn()
    const { promptInput, handleSend, resumeConfirm } = useAgentPrompt(() => agent, onMessageSent)
    promptInput.value = 'hello world'
    await handleSend()
    expect(fetch).not.toHaveBeenCalled()
    expect(onMessageSent).not.toHaveBeenCalled()
    expect(resumeConfirm.value).toBe('hello world')
    expect(promptInput.value).toBe('')
  })

  it('confirmResume POSTs /api/agents/spawn with resumeSessionId and prompt', async () => {
    const agent = makeAgent({ channelAvailable: false, liveInjectable: false, status: 'active', sessionId: 'sess42' })
    const onMessageSent = vi.fn()
    const { promptInput, handleSend, confirmResume, resumeConfirm, sendStatus } = useAgentPrompt(() => agent, onMessageSent)
    promptInput.value = 'do something'
    await handleSend()
    // guard: confirm is set, no fetch yet
    expect(resumeConfirm.value).toBe('do something')
    expect(fetch).not.toHaveBeenCalled()

    await confirmResume()

    expect(fetch).toHaveBeenCalledWith(
      '/api/agents/spawn',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(body.resumeSessionId).toBe('sess42')
    expect(body.prompt).toBe('do something')
    expect(onMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'human', content: 'do something' }),
    )
    expect(resumeConfirm.value).toBeNull()
    expect(sendStatus.value).toBe('sent')
  })

  it('cancelResume restores promptInput and clears resumeConfirm without fetching', async () => {
    const agent = makeAgent({ channelAvailable: false, liveInjectable: false, status: 'active' })
    const { promptInput, handleSend, cancelResume, resumeConfirm } = useAgentPrompt(() => agent)
    promptInput.value = 'my draft message'
    await handleSend()
    expect(resumeConfirm.value).toBe('my draft message')
    expect(promptInput.value).toBe('')

    cancelResume()

    expect(fetch).not.toHaveBeenCalled()
    expect(resumeConfirm.value).toBeNull()
    expect(promptInput.value).toBe('my draft message')
  })

  it('confirmResume does nothing if resumeConfirm is null', async () => {
    const agent = makeAgent({ liveInjectable: false })
    const { confirmResume, resumeConfirm } = useAgentPrompt(() => agent)
    expect(resumeConfirm.value).toBeNull()
    await confirmResume()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('confirmResume clears state gracefully when getAgent returns null at confirm time', async () => {
    let agent: Agent | null = makeAgent({ liveInjectable: false, sessionId: 'gone' })
    const { promptInput, handleSend, confirmResume, resumeConfirm } = useAgentPrompt(() => agent)
    promptInput.value = 'hi'
    await handleSend()
    expect(resumeConfirm.value).toBe('hi')

    agent = null
    await confirmResume()

    expect(fetch).not.toHaveBeenCalled()
    expect(resumeConfirm.value).toBeNull()
  })
})

// The desktop shell registers no service worker, so `ready` never settles there.
describe('useAgentPrompt offline queueing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))
    vi.stubGlobal('SyncManager', class {})
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: new Promise(() => {}) },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports the message as queued even when the service worker never becomes ready', async () => {
    vi.useFakeTimers()
    const agent = makeAgent({ liveInjectable: true })
    const { promptInput, handleSend, isSending, sendStatus } = useAgentPrompt(() => agent)
    promptInput.value = 'offline message'

    const sent = handleSend()
    await vi.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS)
    await sent

    expect(addPending).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline message' }))
    expect(sendStatus.value).toBe('queued')
    expect(isSending.value).toBe(false)
  })
})

/*
 * The echoed message must be the text the SERVER says it delivered, not the
 * text that was typed. Sanitization strips newlines before the prompt reaches
 * the agent, so a client-side echo would render something that was never sent
 * and would not match the same message when the session transcript returns it —
 * which is what made a multi-line prompt appear as two chat bubbles.
 */
describe('useAgentPrompt delivered-text echo', () => {
  const TYPED = 'START-AAAA\n\nMIDDLE-BBBB\nEND-CCCC'
  const DELIVERED = 'START-AAAAMIDDLE-BBBBEND-CCCC'

  function stubInject(body: unknown, ok = true) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })))
  }

  it('echoes the server delivered text, not the typed text', async () => {
    stubInject({ ok: true, delivered: DELIVERED })
    const onMessageSent = vi.fn()
    const { promptInput, handleSend } = useAgentPrompt(
      () => makeAgent({ liveInjectable: true }),
      onMessageSent,
    )
    promptInput.value = TYPED
    await handleSend()

    expect(onMessageSent).toHaveBeenCalledTimes(1)
    expect(onMessageSent.mock.calls[0][0]).toMatchObject({
      role: 'human',
      content: DELIVERED,
    })
  })

  // Nothing is shown until the outcome is known, so exactly one representation
  // of a message exists in client state at any moment.
  it('does not echo before the response resolves', async () => {
    let release: (v: unknown) => void = () => {}
    const pending = new Promise((r) => {
      release = r
    })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await pending
      return { ok: true, json: async () => ({ ok: true, delivered: DELIVERED }) }
    }))

    const onMessageSent = vi.fn()
    const { promptInput, handleSend } = useAgentPrompt(
      () => makeAgent({ liveInjectable: true }),
      onMessageSent,
    )
    promptInput.value = TYPED
    const done = handleSend()

    expect(onMessageSent).not.toHaveBeenCalled()
    release(null)
    await done
    expect(onMessageSent).toHaveBeenCalledTimes(1)
  })

  // A response without the field must not drop the turn from the chat.
  it('falls back to the typed text when the server omits delivered', async () => {
    stubInject({ ok: true })
    const onMessageSent = vi.fn()
    const { promptInput, handleSend } = useAgentPrompt(
      () => makeAgent({ liveInjectable: true }),
      onMessageSent,
    )
    promptInput.value = TYPED
    await handleSend()
    expect(onMessageSent.mock.calls[0][0].content).toBe(TYPED)
  })

  // Nothing was delivered, so there is no canonical text — keep the typed copy
  // as a record rather than losing what the user wrote.
  it('echoes the typed text when delivery fails', async () => {
    stubInject({ error: 'channel not available' }, false)
    const onMessageSent = vi.fn()
    const { promptInput, handleSend, sendStatus } = useAgentPrompt(
      () => makeAgent({ liveInjectable: true }),
      onMessageSent,
    )
    promptInput.value = TYPED
    await handleSend()
    expect(onMessageSent).toHaveBeenCalledTimes(1)
    expect(onMessageSent.mock.calls[0][0].content).toBe(TYPED)
    expect(sendStatus.value).toBe('error')
  })
})
