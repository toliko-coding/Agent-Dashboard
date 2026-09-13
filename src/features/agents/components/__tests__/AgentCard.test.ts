import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AgentCard from '../AgentCard.vue'

// Avoid the real composable's setTimeout localStorage write firing after teardown.
vi.mock('../../composables/useAgentIdentity', () => ({
  useAgentIdentity: () => ({ getIdentity: () => ({ emoji: '🤖' }) }),
}))

const stubs = {
  PromptInput: { template: '<div data-testid="prompt-input" />' },
  MachineBadge: true,
  ProviderBadge: true,
}

function makeAgent(overrides = {}) {
  return {
    pid: 42,
    sessionId: 's1a2b3c4-0000-4000-8000-000000000000',
    provider: 'claude',
    projectPath: '/home/u/agent-dashboard',
    projectName: 'agent-dashboard',
    cwd: '/home/u/agent-dashboard',
    status: 'active',
    working: true,
    uptime: 1680,
    lastActivity: new Date().toISOString(),
    currentAction: '',
    lastOutput: '',
    lastTools: [],
    subagents: [],
    tokenUsage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costEstimate: 6.09,
    costUnknown: false,
    cacheCreationCostEstimate: 0,
    cacheReadCostEstimate: 0,
    healthScore: 79,
    model: 'claude-opus-4-8',
    workspace: null,
    ...overrides,
  } as any
}

describe('agentCard body', () => {
  it('never shows the transcript on the card — the agent\'s details carry it', () => {
    const w = mount(AgentCard, { props: { agent: makeAgent({ lastOutput: 'hello from claude' }) }, global: { stubs } })
    expect(w.text()).not.toContain('hello from claude')
  })

  it('shows what a working agent is doing', () => {
    const w = mount(AgentCard, { props: { agent: makeAgent() }, global: { stubs } })
    expect(w.get('[data-testid="agent-card-activity"]').text()).toBe('Working')
  })

  it('falls back to the last tool for an agent that is not working', () => {
    const w = mount(AgentCard, { props: { agent: makeAgent({ working: false, currentAction: '', lastTools: [{ name: 'Read' }] }) }, global: { stubs } })
    expect(w.get('[data-testid="agent-card-activity"]').text()).toBe('Last tool Read')
  })
})

describe('agentCard interaction', () => {
  it('emits select when the card open target is clicked', async () => {
    const w = mount(AgentCard, { props: { agent: makeAgent() }, global: { stubs } })
    await w.get('[data-testid="agent-card-open"]').trigger('click')
    expect(w.emitted('select')).toBeTruthy()
  })

  it('does not emit select when the prompt input is clicked', async () => {
    const w = mount(AgentCard, { props: { agent: makeAgent() }, global: { stubs } })
    await w.get('[data-testid="prompt-input"]').trigger('click')
    expect(w.emitted('select')).toBeFalsy()
  })

  it('emits select when the card body is clicked', async () => {
    const w = mount(AgentCard, { props: { agent: makeAgent() }, global: { stubs } })
    await w.get('[data-testid="agent-card-body"]').trigger('click')
    expect(w.emitted('select')).toBeTruthy()
  })

  it('does not emit select when the dismiss button is clicked', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({})))
    const w = mount(AgentCard, { props: { agent: makeAgent({ status: 'finished' }) }, global: { stubs } })
    await w.get('[data-testid="agent-card-dismiss"]').trigger('click')
    expect(w.emitted('select')).toBeFalsy()
    vi.unstubAllGlobals()
  })

  it('does not emit select when the info button is clicked, and reveals the metrics popover', async () => {
    const w = mount(AgentCard, { props: { agent: makeAgent() }, global: { stubs } })
    expect(w.find('[data-testid="metrics-popover"]').exists()).toBe(false)
    await w.get('[data-testid="agent-card-info"]').trigger('click')
    expect(w.find('[data-testid="metrics-popover"]').exists()).toBe(true)
    expect(w.emitted('select')).toBeFalsy()
  })
})

describe('agentCard header', () => {
  it('shows the agent name with a title tooltip, not the folder name', () => {
    const w = mount(AgentCard, { props: { agent: makeAgent({ projectName: 'agent-dashboard' }) }, global: { stubs } })
    const name = w.get('[data-testid="agent-card-title"]')
    expect(name.text()).toBe('Claude session s1a2b3c4')
    expect(name.attributes('title')).toBe('Claude session s1a2b3c4')
  })
})
