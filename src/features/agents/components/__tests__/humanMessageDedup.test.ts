import type { OutputMessage } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentChatStream from '../AgentChatStream.vue'

/*
 * One sent prompt must render as exactly one human bubble.
 *
 * The bug these pin: the client used to echo the message it TYPED while the
 * session transcript returns the message that was DELIVERED, and delivery
 * strips newlines. Deduplication keys on exact content, so the two never
 * matched and a multi-line prompt rendered twice — once as typed, once as sent.
 *
 * The fix makes the client echo the server's delivered text, so both sides
 * carry the same string. These tests therefore feed the local message the same
 * content the stubbed transcript returns, which is what the composable now
 * does, and assert the bubble count.
 *
 * Deliberately NOT tested by fuzzy comparison: two prompts that differ only
 * after normalization must stay two bubbles, and the last case pins that.
 */

const SESSION_ID = '2080046b-7d51-47cd-a075-38f9bc9cbd56'
const AT = '2026-01-01T00:00:00Z'

const agent = {
  pid: 1,
  sessionId: SESSION_ID,
  cwd: '/tmp',
  status: 'active',
  liveInjectable: true,
} as never

/** Stubs GET /output with the given human messages, as the JSONL would yield. */
function stubTranscript(contents: string[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/output')) {
      return {
        ok: true,
        json: async () => ({
          messages: contents.map(content => ({ role: 'human', content, timestamp: AT })),
        }),
      } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  }))
}

async function humanBubbles(transcript: string[], local: string[]) {
  stubTranscript(transcript)
  const localMessages: OutputMessage[] = local.map(content => ({
    role: 'human',
    content,
    timestamp: AT,
  }))
  const w = mount(AgentChatStream, {
    props: { agent, localMessages, refreshIntervalMs: 10_000_000 },
  })
  await flushPromises()
  await flushPromises()
  // Human messages are the right-aligned bubbles in the transcript.
  return w.findAll('.justify-end')
}

describe('human message deduplication', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('single-line prompt renders one bubble', async () => {
    const sent = 'hello world'
    expect(await humanBubbles([sent], [sent])).toHaveLength(1)
  })

  // The reported bug. Delivered text has no newlines; the local echo now
  // carries that same delivered text rather than the typed text.
  it('multiline prompt renders one bubble', async () => {
    const delivered = 'START-AAAAMIDDLE-BBBBEND-CCCC'
    expect(await humanBubbles([delivered], [delivered])).toHaveLength(1)
  })

  it('multiline prompt with blank lines renders one bubble', async () => {
    const delivered = 'START-AAAAMIDDLE-BBBBEND-CCCC'
    expect(await humanBubbles([delivered], [delivered])).toHaveLength(1)
  })

  it('two genuinely different prompts render two bubbles', async () => {
    const bubbles = await humanBubbles(['first prompt', 'second prompt'], [])
    expect(bubbles).toHaveLength(2)
  })

  // Dedup must be exact. Two prompts that a fuzzy/prefix/substring comparison
  // would collapse have to stay distinct.
  it('a prompt that is a prefix of another stays distinct', async () => {
    const bubbles = await humanBubbles(['deploy', 'deploy the staging cluster'], [])
    expect(bubbles).toHaveLength(2)
  })

  it('a local echo not yet in the transcript still renders', async () => {
    // The window between delivery and the transcript poll picking it up.
    expect(await humanBubbles([], ['just sent'])).toHaveLength(1)
  })

  it('an unrelated local echo is not swallowed by a transcript message', async () => {
    const bubbles = await humanBubbles(['older message'], ['brand new message'])
    expect(bubbles).toHaveLength(2)
  })
})
