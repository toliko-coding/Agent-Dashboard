import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AgentRow from './AgentRow.vue'

const baseAgent: Agent = {
  pid: 1234,
  sessionId: 'sess-1',
  provider: 'claude',
  projectPath: '/home/user/my-project',
  projectName: 'my-project',
  cwd: '/home/user/my-project',
  entrypoint: 'cli',
  status: 'active',
  uptime: 60,
  lastActivity: '2026-01-01T00:00:00Z',
  lastTools: [],
  tasks: [],
  subagents: [],
  tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
  costEstimate: 0,
  cacheCreationCostEstimate: 0,
  cacheReadCostEstimate: 0,
  healthScore: 80,
  conversationTurns: 0,
  toolCounts: {},
  channelAvailable: false,
  working: false,
  permissionsBypassed: false,
  convergenceAlert: false,
  meta: null,
  workspace: null,
}

async function mountExpanded(agent: Agent) {
  const wrapper = mount(AgentRow, { props: { agent } })
  await wrapper.find('button[aria-expanded]').trigger('click')
  return wrapper
}

describe('agentRow internal process badge', () => {
  it('shows the internal-process badge when agent.internalProcess is true', async () => {
    const wrapper = await mountExpanded({ ...baseAgent, internalProcess: true })
    expect(wrapper.find('[data-testid="agent-row-internal-badge"]').exists()).toBe(true)
  })

  it('hides the internal-process badge for a normal session', async () => {
    const wrapper = await mountExpanded({ ...baseAgent, internalProcess: false })
    expect(wrapper.find('[data-testid="agent-row-internal-badge"]').exists()).toBe(false)
  })
})

describe('agentRow — canonical name (3I)', () => {
  it('names the agent like the card does, not by folder', async () => {
    const { agentTitle } = await import('@/utils/agentLabels')
    const w = mount(AgentRow, { props: { agent: { ...baseAgent, projectName: 'secret-folder' } } })
    expect(w.text()).toContain(agentTitle(baseAgent))
    expect(w.text()).not.toMatch(/secret[- ]folder/i)
  })
})

describe('agentRow — card hierarchy in a dense row (3L)', () => {
  const ws = { id: 'ws1', name: 'app-wt', kind: 'git-worktree', branch: 'feat/x', repository: { id: 'r1', name: 'app' } }

  // C
  it('places the agent by repository and workspace, never by folder', () => {
    const w = mount(AgentRow, { props: { agent: { ...baseAgent, workspace: ws } as Agent } })
    expect(w.get('[data-testid="agent-row-repository"]').text()).toBe('app')
    expect(w.get('[data-testid="agent-row-where"]').text()).toContain('feat/x')
    expect(w.get('[data-testid="agent-row-where"]').text()).not.toContain('my-project')
  })

  it('says Workspace unknown when identity did not resolve', () => {
    const w = mount(AgentRow, { props: { agent: baseAgent } })
    expect(w.get('[data-testid="agent-row-workspace-unknown"]').text()).toBe('Workspace unknown')
  })

  // D
  it('keeps working, resting and idle distinct, in words', () => {
    const state = (over: Partial<Agent>) => mount(AgentRow, { props: { agent: { ...baseAgent, ...over } } })
    expect(state({ status: 'active', working: true }).get('[data-testid="agent-row"]').attributes('data-state')).toBe('working')
    expect(state({ status: 'active', working: false }).get('[data-testid="agent-row"]').attributes('data-state')).toBe('active')
    const idle = state({ status: 'idle' })
    expect(idle.get('[data-testid="agent-row"]').attributes('data-state')).toBe('idle')
    expect(idle.text()).toContain('Idle')
    expect(idle.find('[data-testid="agent-row-attention"]').exists()).toBe(false)
  })

  it('shows attention only from the canonical queue item', () => {
    const blocking = { level: 'blocking', reason: 'Question', subject: { type: 'agent', sessionId: 'sess-1' } } as never
    const failed = { level: 'failed', reason: 'API error reported: Rate limited', subject: { type: 'agent', sessionId: 'sess-1' } } as never
    const needs = mount(AgentRow, { props: { agent: { ...baseAgent, working: true }, attention: blocking } })
    expect(needs.get('[data-testid="agent-row-attention"]').text()).toBe('Needs you')
    expect(needs.get('[data-testid="agent-row"]').attributes('data-attention')).toBe('blocking')
    const fail = mount(AgentRow, { props: { agent: baseAgent, attention: failed } })
    expect(fail.get('[data-testid="agent-row-attention"]').text()).toBe('Failed')
    // A pending question on the agent is not enough: the queue decides.
    const noItem = mount(AgentRow, { props: { agent: { ...baseAgent, pendingQuestion: { question: 'x' } } as unknown as Agent } })
    expect(noItem.find('[data-testid="agent-row-attention"]').exists()).toBe(false)
  })

  it('names what it is doing by tool name only', () => {
    const w = mount(AgentRow, { props: { agent: { ...baseAgent, working: true, pendingToolUse: { id: 't', tool: 'Bash', input: { command: 'rm -rf /tmp/secret' } } } as unknown as Agent } })
    expect(w.get('[data-testid="agent-row-activity"]').text()).toBe('Using Bash')
    expect(w.html()).not.toContain('rm -rf')
  })

  // B
  it('shows no transcript, cwd or PID — collapsed or expanded', async () => {
    const agent = { ...baseAgent, lastOutput: 'SECRET TRANSCRIPT LINE' } as Agent
    const w = await mountExpanded(agent)
    expect(w.find('[data-testid="agent-row-expanded"]').exists()).toBe(true)
    expect(w.html()).not.toContain('SECRET TRANSCRIPT')
    expect(w.html()).not.toContain('/home/user')
    expect(w.text()).not.toContain('PID')
    expect(w.text()).not.toContain('1234')
  })

  it('does not colour cost as success', () => {
    const w = mount(AgentRow, { props: { agent: { ...baseAgent, costEstimate: 1.5 } } })
    expect(w.get('[data-testid="agent-row-cost"]').classes()).not.toContain('text-success-text')
  })

  // J
  it('has no axe violations, expanded, with attention', async () => {
    const { axe } = await import('@/utils/testA11y')
    const blocking = { level: 'blocking', reason: 'Question', subject: { type: 'agent', sessionId: 'sess-1' } } as never
    const w = mount(AgentRow, { props: { agent: { ...baseAgent, workspace: ws } as Agent, attention: blocking }, attachTo: document.body })
    await w.find('button[aria-expanded]').trigger('click')
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
