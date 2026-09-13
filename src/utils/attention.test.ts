import type { PendingToolUse } from '../sdk.generated'
import type { Agent } from '../types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attentionFor } from './attention'

// Typed so a fixture cannot silently drop a field the wire type requires.
function toolUse(o: Partial<PendingToolUse> & Pick<PendingToolUse, 'tool'>): PendingToolUse {
  return { id: 'tu_1', pattern: '', patternDisplay: o.pattern ?? '', ...o }
}

const QUESTION = {
  header: 'Choose',
  question: 'Which one?',
  multiSelect: false,
  options: [{ index: 1, label: 'A' }],
  typeSomethingIndex: 2,
  chatAboutIndex: 3,
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    sessionId: 'test-session',
    pid: 1234,
    projectName: 'test-project',
    projectPath: '/test/path',
    cwd: '/test/path',
    status: 'active',
    uptime: 0,
    lastActivity: new Date().toISOString(),
    currentAction: null,
    lastTools: [],
    tasks: [],
    subagents: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    costEstimate: 0,
    cacheCreationCostEstimate: 0,
    cacheReadCostEstimate: 0,
    healthScore: 100,
    conversationTurns: 0,
    toolCounts: {},
    channelAvailable: false,
    convergenceAlert: false,
    meta: null,
    costUnknown: false,
    provider: 'claude',
    entrypoint: 'cli',
    ...overrides,
  } as Agent
}

describe('attentionFor — blocking evidence', () => {
  it('reports a detected question', () => {
    expect(attentionFor(makeAgent({ pendingQuestion: QUESTION }))?.kind).toBe('question')
  })

  it('ranks a question above stored permissions and a pending tool use', () => {
    const agent = makeAgent({
      pendingQuestion: QUESTION,
      pendingPermissions: [{ id: 'r1', tool: 'Bash', pattern: 'ls', requestedAt: new Date().toISOString() }],
      pendingToolUse: toolUse({ tool: 'Bash', pattern: 'ls' }),
    })
    expect(attentionFor(agent)?.kind).toBe('question')
  })

  // A session parked on the review/submit screen is just as blocked as one
  // showing the modal — it waits for a keypress that only a human can give.
  it('reports the answers submit screen as a question', () => {
    const att = attentionFor(makeAgent({
      pendingConfirm: { question: 'Ready to submit your answers?', options: [{ index: 1, label: 'Submit answers' }] },
      pendingPermissions: [{ id: 'r1', tool: 'Bash', pattern: 'ls', requestedAt: new Date().toISOString() }],
    }))
    expect(att?.kind).toBe('question')
    expect(att?.label).toBe('Confirm answers')
  })

  it('reports stored pipeline permissions, and ranks them above a pending tool use', () => {
    const att = attentionFor(makeAgent({
      pendingPermissions: [{ id: 'r1', tool: 'Bash', pattern: 'git push', requestedAt: new Date().toISOString() }],
      pendingToolUse: toolUse({ tool: 'WebFetch' }),
    }))
    expect(att?.kind).toBe('permission')
  })

  // Task-driven grants are real DB rows, not an inference from the transcript.
  it('still reports task permission requests for a bypassed session', () => {
    const agent = makeAgent({
      permissionsBypassed: true,
      pendingPermissions: [{ id: 'p1', tool: 'Bash', pattern: 'ls', requestedAt: new Date().toISOString() }],
    })
    expect(attentionFor(agent)?.kind).toBe('permission')
  })

  // AskUserQuestion completes only when a person answers, so its unresolved
  // tool call is evidence even where the screen cannot be read.
  it('reports an unanswered AskUserQuestion in a session whose screen cannot be read', () => {
    const att = attentionFor(makeAgent({ pendingToolUse: toolUse({ tool: 'AskUserQuestion' }) }))
    expect(att?.kind).toBe('question')
    expect(att?.label).toBe('Question in terminal')
    expect(att?.grantable).toBe(false)
  })
})

describe('attentionFor — failure', () => {
  it('reports a classified API error on a session that is not working', () => {
    const att = attentionFor(makeAgent({ errorState: 'auth_failed', working: false }))
    expect(att?.kind).toBe('error')
    expect(att?.tone).toBe('danger')
  })

  // errorState is never cleared by a later success, so a working session's error is history.
  it('does not report an error on a session that is working again', () => {
    expect(attentionFor(makeAgent({ errorState: 'rate_limited', working: true }))).toBeNull()
  })

  it('returns null for a finished agent even with a reconstructed errorState', () => {
    const agent = makeAgent({ status: 'finished', errorState: 'auth_failed', pendingToolUse: toolUse({ tool: 'Bash', pattern: 'ls' }) })
    expect(attentionFor(agent)).toBeNull()
  })
})

describe('attentionFor — not attention', () => {
  it('returns null for an idle agent whose turn has finished', () => {
    expect(attentionFor(makeAgent({ status: 'idle', working: false }))).toBeNull()
  })

  it('returns null for a healthy active agent', () => {
    expect(attentionFor(makeAgent({ status: 'active', working: true }))).toBeNull()
  })

  // A session started with --dangerously-skip-permissions never stops for a
  // prompt, so its unresolved tool_use means the tool is running.
  it('does not read a running tool as a permission prompt when permissions are bypassed', () => {
    expect(attentionFor(makeAgent({ permissionsBypassed: true, pendingToolUse: toolUse({ tool: 'Bash', pattern: 'sleep 60' }) }))).toBeNull()
  })

  // The symptom report: a still-running tool and a genuinely blocked one are
  // the same JSONL shape.
  it('does not read a busy agent\'s unresolved tool use as attention', () => {
    expect(attentionFor(makeAgent({ working: true, pendingToolUse: toolUse({ tool: 'WebSearch' }) }))).toBeNull()
  })

  // The retired stall heuristic: no amount of silence turns an unresolved tool
  // call into attention, because a long build looks exactly the same.
  it('does not infer a stall from a long-unresolved tool call', () => {
    const agent = makeAgent({
      status: 'active',
      working: false,
      lastActivity: new Date(Date.now() - 60 * 60_000).toISOString(),
      pendingToolUse: toolUse({ tool: 'Bash', pattern: 'git push' }),
    })
    expect(attentionFor(agent)).toBeNull()
  })

  it('carries no stall or your-turn kind at all', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/utils/attention.ts'), 'utf8')
    expect(source).not.toMatch(/'stalled'|'yourTurn'|STALLED_THRESHOLD|isStalled|isAwaitingInput/)
  })
})

describe('grantable is opt-in', () => {
  // The band offers a permission grant only where a prompt is genuinely on
  // screen. This pins the positive form.
  it('marks only a permission prompt as grantable', () => {
    const grantable = (a: Partial<Agent>) => attentionFor(makeAgent(a))?.grantable

    expect(grantable({ pendingPermissions: [{ tool: 'Bash' }] as never })).toBe(true)

    // A question is answered, never granted.
    expect(grantable({ pendingQuestion: { prompt: 'q', options: [] } as never })).toBe(false)
    expect(grantable({ pendingConfirm: { question: 'ready?', options: [] } as never })).toBe(false)

    // A busy agent with an unresolved tool call is not attention at all, so
    // there is nothing to grant against.
    expect(attentionFor(makeAgent({ pendingToolUse: toolUse({ id: 't', tool: 'Bash' }) }))).toBeNull()

    expect(grantable({ errorState: 'auth_failed' as never })).toBe(false)
  })

  // The terminal notice fires once when the prompt opens and never when it is
  // answered, so it outlives its prompt; a grant offered on the pair alone
  // names a tool nobody asked about.
  it('grants against a terminal prompt only when the bridge named the call', () => {
    const att = (a: Partial<Agent>) => attentionFor(makeAgent(a))

    const named = att({ awaitingTerminalPermission: true, terminalPermissionToolUseId: 'tu_9', pendingToolUse: toolUse({ id: 'tu_9', tool: 'Bash' }) })
    expect(named?.label).toBe('Answer in terminal')
    expect(named?.grantable).toBe(true)

    const mismatched = att({ awaitingTerminalPermission: true, terminalPermissionToolUseId: 'tu_9', pendingToolUse: toolUse({ id: 'tu_other', tool: 'Read' }) })
    expect(mismatched?.grantable).toBe(false)

    const unnamed = att({ awaitingTerminalPermission: true, pendingToolUse: toolUse({ id: 'tu_9', tool: 'Bash' }) })
    expect(unnamed?.label).toBe('Answer in terminal')
    expect(unnamed?.grantable).toBe(false)
  })
})
