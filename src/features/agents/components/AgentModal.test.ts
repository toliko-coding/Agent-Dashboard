import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AgentModal from './AgentModal.vue'

vi.mock('@/features/agents/composables/useAgentIdentity', () => ({
  useAgentIdentity: () => ({ getIdentity: () => ({ emoji: '🤖' }) }),
}))

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
  lastTools: [{ name: 'Read', detail: 'src/main.ts' }],
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

const stubs = {
  AppModal: { template: '<div><slot /></div>' },
  AgentChatStream: true,
  CrossLinkBanner: true,
  MachineBadge: true,
  PromptInput: true,
  SubAgentList: true,
  TaskList: true,
  ToolTimeline: true,
  AppBadge: true,
  AgentTerminal: true,
}

function mountModal(agent: Agent = baseAgent) {
  return mount(AgentModal, { props: { agent }, global: { stubs } })
}

describe('agentModal subagent transcript', () => {
  const subagent = {
    id: '33333333-3333-3333-3333-333333333333',
    type: 'subagent',
    status: 'completed',
    currentAction: '',
    sessionFile: '/tmp/x.jsonl',
    tokensUsed: 0,
    durationSeconds: 0,
    latestOutput: '',
  }

  function mountWithSubagent() {
    return mount(AgentModal, {
      props: { agent: { ...baseAgent, subagents: [subagent] } as Agent },
      global: { stubs: { ...stubs, SubAgentList: false, PromptInput: { template: '<div />', methods: { focus() {} } } } },
    })
  }

  it('opens the subagent transcript in place of the session transcript', async () => {
    const w = mountWithSubagent()
    expect(w.find('[data-testid="subagent-transcript"]').exists()).toBe(false)

    await w.get('[data-testid="subagent-open"]').trigger('click')
    expect(w.get('[data-testid="subagent-transcript"]').attributes('sessionid')).toBe(subagent.id)
  })

  it('returns to the session transcript', async () => {
    const w = mountWithSubagent()
    await w.get('[data-testid="subagent-open"]').trigger('click')
    await w.get('[data-testid="subagent-back"]').trigger('click')
    expect(w.find('[data-testid="subagent-transcript"]').exists()).toBe(false)
  })

  // The modal is reused across agents; a stale subagent would open on the wrong session.
  it('drops the open subagent when the modal switches agents', async () => {
    const w = mountWithSubagent()
    await w.get('[data-testid="subagent-open"]').trigger('click')

    await w.setProps({ agent: { ...baseAgent, sessionId: 'other-session', subagents: [] } as Agent })
    expect(w.find('[data-testid="subagent-transcript"]').exists()).toBe(false)
  })
})

describe('agentModal session context', () => {
  const withContext = {
    ...baseAgent,
    tasks: [{ subject: 'Ship it', status: 'in_progress' }],
    subagents: [],
  } as unknown as Agent

  // The bottom drawer is gone: what you read while reading the transcript sits
  // beside it, and the modal keeps no tab bar at its foot.
  it('renders session context beside the transcript, not in a drawer', () => {
    const w = mount(AgentModal, { props: { agent: withContext }, global: { stubs: { ...stubs, TaskList: false } } })
    expect(w.find('[data-testid="agent-context"]').exists()).toBe(true)
    expect(w.find('details').exists()).toBe(false)
  })

  it('omits the context block when the agent has none', () => {
    const w = mountModal({ ...baseAgent, lastTools: [], tasks: [], subagents: [], recentHookEvents: [] } as unknown as Agent)
    expect(w.find('[data-testid="agent-context"]').exists()).toBe(false)
  })

  it('offers the token breakdown from the header instead of a token table', async () => {
    const w = mountModal()
    expect(w.findComponent({ name: 'MetricsPopover' }).exists()).toBe(false)
    await w.get('[data-testid="agent-modal-metrics"]').trigger('click')
    expect(w.findComponent({ name: 'MetricsPopover' }).exists()).toBe(true)
  })

  // The terminal moved to the card; mounting xterm from the modal would defeat that.
  it('mounts no terminal', () => {
    const w = mountModal({ ...baseAgent, liveInjectable: true })
    expect(w.html()).not.toContain('agent-terminal')
  })
})

/*
 * Agent workspace behaviour (Phase 5). The drawer's Overview/Transcript tabs
 * are gone — intelligence sits beside the conversation now — but the honesty
 * cases they guarded still matter: the reference design showed Pause / Stop and
 * a "Phase N/7", none of which the backend can support for a spawned agent.
 */
describe('agentModal — workspace', () => {
  function workspace(agent: Agent = baseAgent) {
    return mount(AgentModal, {
      props: { agent },
      global: { stubs: { ...stubs, AgentIntelligencePanel: true } },
    })
  }

  it('renders a large workspace rather than a narrow drawer', () => {
    const w = workspace()
    const box = w.get('[data-testid="agent-workspace"]')
    // Sized from the viewport, and explicitly not the old 560px panel.
    expect(box.classes().join(' ')).toContain('w-[min(1500px,96vw)]')
    expect(w.find('[data-testid="agent-details-panel"]').exists()).toBe(false)
  })

  it('gives the conversation its own labelled region', () => {
    const w = workspace()
    expect(w.find('section[aria-label="Conversation"]').exists()).toBe(true)
  })

  it('exposes no pause or stop action — no such endpoint exists', () => {
    const w = workspace()
    const text = w.text().toLowerCase()
    expect(text).not.toContain('pause')
    expect(text).not.toContain('stop')
  })

  // A "Phase 3/7" for a plain agent would be invented; only pipeline-linked
  // agents have a real stage. TodoWrite items are shown as tasks instead.
  it('omits task counts entirely when the session wrote no TodoWrite items', () => {
    const w = workspace()
    expect(w.find('[data-testid="header-tasks"]').exists()).toBe(false)
    expect(w.text().toLowerCase()).not.toContain('phase')
  })

  it('shows task progress as a completed ratio, never as a phase', () => {
    const w = workspace({
      ...baseAgent,
      tasks: [
        { id: '1', subject: 'a', status: 'completed' },
        { id: '2', subject: 'b', status: 'completed' },
        { id: '3', subject: 'c', status: 'in_progress' },
      ],
    } as Agent)
    const tasks = w.get('[data-testid="header-tasks"]')
    expect(tasks.text()).toContain('2 / 3')
    expect(tasks.text().toLowerCase()).not.toContain('phase')
  })

  it('warns that a session started outside the dashboard resumes rather than injects', () => {
    const w = workspace({ ...baseAgent, liveInjectable: false } as Agent)
    expect(w.find('[data-testid="agent-resume-note"]').exists()).toBe(true)
  })

  it('says a remote session cannot be messaged, and offers no prompt box', () => {
    const w = workspace({ ...baseAgent, machine: 'build-box' } as Agent)
    expect(w.get('[data-testid="agent-unreachable-note"]').text()).toContain('build-box')
    expect(w.findComponent({ name: 'PromptInput' }).exists()).toBe(false)
  })

  it('shows a Started time derived from uptime, not an invented estimate', () => {
    const w = workspace()
    expect(w.text()).toContain('Started')
    expect(w.text().toLowerCase()).not.toContain('est.')
    expect(w.text().toLowerCase()).not.toContain('remaining')
  })
})
