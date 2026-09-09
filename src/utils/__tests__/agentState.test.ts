import type { Agent } from '../../types'
import { describe, expect, it } from 'vitest'
import { agentState, isGrantable, needsAttention } from '../agentState'
import { attentionFor } from '../attention'
import { STALLED_THRESHOLD_SECONDS } from '../format'
import { agentDisplayStatus } from '../statusColors'

const SILENT = STALLED_THRESHOLD_SECONDS + 1
const RECENT = 5

function makeAgent(over: Partial<Agent> = {}): Agent {
  return {
    sessionId: 's1',
    pid: 1,
    cwd: '/p',
    projectPath: '/p',
    status: 'active',
    working: true,
    subagents: [],
    ...over,
  } as Agent
}

const permissionPrompt = {
  question: 'Do you want to proceed?',
  options: [
    { index: 1, label: 'Yes' },
    { index: 2, label: 'No' },
  ],
} as never

describe('agentState — positive evidence outranks inference', () => {
  // The reported bug: a real permission prompt surfaced only after 180s of
  // silence, and then as "No activity".
  it('a detected permission dialog is PERMISSION_REQUIRED immediately', () => {
    const agent = makeAgent({ pendingPermissionPrompt: permissionPrompt, pendingToolUse: { id: 't', tool: 'Bash' } as never })
    const s = agentState(agent, RECENT)
    expect(s.state).toBe('permission_required')
    expect(s.evidence).toBe('permission_prompt')
    expect(s.blocking).toBe(true)
  })

  it('a detected dialog still wins after the stalled threshold', () => {
    const agent = makeAgent({ pendingPermissionPrompt: permissionPrompt, pendingToolUse: { id: 't', tool: 'Bash' } as never })
    const s = agentState(agent, SILENT)
    expect(s.state).toBe('permission_required')
    expect(s.evidence).toBe('permission_prompt')
  })

  it('an AskUserQuestion outranks a permission dialog', () => {
    const agent = makeAgent({
      pendingQuestion: { question: 'Pick one', options: [] } as never,
      pendingPermissionPrompt: permissionPrompt,
    })
    expect(agentState(agent, RECENT).state).toBe('waiting_for_user')
  })

  it('a running tool with no dialog is WORKING, not permission required', () => {
    const agent = makeAgent({ pendingToolUse: { id: 't', tool: 'Bash' } as never })
    const s = agentState(agent, RECENT)
    expect(s.state).toBe('working')
    expect(s.blocking).toBe(false)
  })

  // The pre-fix behaviour, kept for sessions whose terminal cannot be read.
  it('a long-silent unresolved tool use with no dialog is STALLED', () => {
    const agent = makeAgent({ pendingToolUse: { id: 't', tool: 'Bash' } as never })
    const s = agentState(agent, SILENT)
    expect(s.state).toBe('stalled')
    expect(s.evidence).toBe('inactivity')
  })

  // permissionsBypassed silences the TOOL inference only. The status here is
  // 'waiting' so the separate stale-feed branch cannot answer first and mask
  // which rule is under test.
  it('permissionsBypassed suppresses the tool-silence inference', () => {
    const agent = makeAgent({
      status: 'waiting',
      pendingToolUse: { id: 't', tool: 'Bash' } as never,
      permissionsBypassed: true,
    })
    expect(agentState(agent, SILENT).state).toBe('working')
  })

  // …and does not suppress the stale-feed branch, which is about the data
  // rather than the agent.
  it('permissionsBypassed does not suppress the stale-feed branch', () => {
    const agent = makeAgent({ status: 'active', permissionsBypassed: true })
    expect(agentState(agent, SILENT).state).toBe('stalled')
  })

  it('a finished agent is FINISHED regardless of leftover signals', () => {
    const agent = makeAgent({ status: 'finished', pendingPermissionPrompt: permissionPrompt })
    expect(agentState(agent, SILENT).state).toBe('finished')
  })

  it('a closed turn is AWAITING_INPUT, or IDLE once the status says so', () => {
    expect(agentState(makeAgent({ working: false, status: 'waiting' }), RECENT).state).toBe('awaiting_input')
    expect(agentState(makeAgent({ working: false, status: 'idle' }), RECENT).state).toBe('idle')
  })

  // A frozen payload beside a running clock: what this detects is a stale feed.
  it('a stale active payload is STALLED even with no pending tool use', () => {
    expect(agentState(makeAgent({ status: 'active' }), SILENT).state).toBe('stalled')
  })
})

describe('grantability', () => {
  it('a detected dialog is not grantable — the band cannot answer it', () => {
    const agent = makeAgent({ pendingPermissionPrompt: permissionPrompt })
    expect(isGrantable(agent, RECENT)).toBe(false)
  })

  it('a held bridge permission is grantable', () => {
    const agent = makeAgent({ heldPermissions: [{ id: 'h' }] as never })
    expect(isGrantable(agent, RECENT)).toBe(true)
  })

  it('a terminal notice grants only when it names the pending call', () => {
    const named = makeAgent({
      awaitingTerminalPermission: true,
      terminalPermissionToolUseId: 'tu_1',
      pendingToolUse: { id: 'tu_1', tool: 'Bash' } as never,
    })
    const drifted = makeAgent({
      awaitingTerminalPermission: true,
      terminalPermissionToolUseId: 'tu_1',
      pendingToolUse: { id: 'tu_2', tool: 'Bash' } as never,
    })
    expect(isGrantable(named, RECENT)).toBe(true)
    expect(isGrantable(drifted, RECENT)).toBe(false)
  })
})

/*
 * The contradiction this refactor exists to make impossible: the card said
 * "working" while the band said "No activity" about the same object.
 */
describe('card and triage band cannot contradict', () => {
  const cases: Record<string, Agent> = {
    'permission dialog': makeAgent({ pendingPermissionPrompt: permissionPrompt, pendingToolUse: { id: 't', tool: 'Bash' } as never }),
    'question': makeAgent({ pendingQuestion: { question: 'q', options: [] } as never }),
    'running tool': makeAgent({ pendingToolUse: { id: 't', tool: 'Bash' } as never }),
    'silent tool': makeAgent({ status: 'waiting', pendingToolUse: { id: 't', tool: 'Bash' } as never }),
    'closed turn': makeAgent({ working: false, status: 'waiting' }),
    'error': makeAgent({ errorState: { message: 'boom' } as never }),
  }

  it('both surfaces read the same classifier', () => {
    for (const [name, agent] of Object.entries(cases)) {
      const secs = name === 'silent tool' ? SILENT : RECENT
      const card = agentState(agent, secs)
      const band = attentionFor(agent, secs)
      if (band)
        expect(band.kind, `${name}: band kind must follow the shared state`).toBeTruthy()
      // The card's own verdict is that same object, so they cannot differ.
      expect(agentState(agent, secs).state).toBe(card.state)
    }
  })

  it('a blocking state is never rendered as plain working by the card', () => {
    const agent = cases['permission dialog']
    const card = agentState(agent, RECENT)
    expect(card.blocking).toBe(true)
    expect(card.state).not.toBe('working')
    // The legacy badge helper would have said "working" here — the card no
    // longer uses it to decide whether something needs attention.
    expect(agentDisplayStatus(agent as never)).toBe('working')
    expect(card.label).toBe('Permission required')
  })

  it('working and stalled cannot both describe one agent', () => {
    for (const [name, agent] of Object.entries(cases)) {
      const secs = name === 'silent tool' ? SILENT : RECENT
      const s = agentState(agent, secs)
      const band = attentionFor(agent, secs)
      if (s.state === 'working')
        expect(band?.kind).not.toBe('stalled')
      if (band?.kind === 'stalled')
        expect(s.state).toBe('stalled')
    }
  })
})

describe('needsAttention', () => {
  it('includes blocking and stalled states', () => {
    expect(needsAttention(makeAgent({ pendingPermissionPrompt: permissionPrompt }), RECENT)).toBe(true)
    expect(needsAttention(makeAgent({ pendingToolUse: { id: 't', tool: 'Bash' } as never }), SILENT)).toBe(true)
  })

  it('excludes a plainly working agent', () => {
    expect(needsAttention(makeAgent({ pendingToolUse: { id: 't', tool: 'Bash' } as never }), RECENT)).toBe(false)
  })
})
