import type { AttentionItem } from '@/features/attention'
import type { Agent, SubAgent } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import AgentCard from './AgentCard.vue'

vi.mock('@/features/agents/composables/useAgentIdentity', () => ({
  useAgentIdentity: () => ({
    getIdentity: () => ({ emoji: '🤖' }),
  }),
}))

const baseAgent: Agent = {
  pid: 918273,
  sessionId: '3f2a1b9c-0000-4000-8000-000000000000',
  provider: 'claude',
  projectPath: '/home/user/secret-client/my-project',
  projectName: 'my-project',
  cwd: '/home/user/secret-client/my-project',
  entrypoint: 'cli',
  status: 'active',
  uptime: 60,
  lastActivity: new Date().toISOString(),
  lastTools: [],
  tasks: [],
  subagents: [],
  tokenUsage: { inputTokens: 1200, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 0 },
  costEstimate: 1.25,
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
  lastOutput: 'TRANSCRIPT: the deploy key is abc123',
} as Agent

const activeSubagent: SubAgent = {
  id: 'sa-1',
  type: 'researcher',
  status: 'active',
  currentAction: 'Read',
  sessionFile: '/tmp/sa-1.jsonl',
  tokensUsed: 5000,
  durationSeconds: 90,
  latestOutput: 'SUBAGENT OUTPUT: analysing the codebase',
}

const stubs = { MachineBadge: true, ProviderBadge: true, PromptInput: true }
function render(agent: Partial<Agent> = {}, attention: AttentionItem | null = null) {
  return mount(AgentCard, { props: { agent: { ...baseAgent, ...agent } as Agent, attention }, global: { stubs } })
}

function item(level: AttentionItem['level'], reason: string): AttentionItem {
  return { id: `agent:${baseAgent.sessionId}`, level, kind: level === 'failed' ? 'api-error' : 'permission', subject: { type: 'agent', sessionId: baseAgent.sessionId }, agentSessionId: baseAgent.sessionId, workspace: null, repository: null, title: '', reason, since: null, lastActivity: null }
}

describe('agentCard — opening', () => {
  it('renders a real button with data-testid="agent-card-open" named after the agent', () => {
    const btn = render().get('button[data-testid="agent-card-open"]')
    expect(btn.attributes('aria-label')).toBe('Open details for Claude session 3f2a1b9c')
  })

  it('clicking the open button emits select with the agent', async () => {
    const w = render()
    await w.get('button[data-testid="agent-card-open"]').trigger('click')
    expect(w.emitted('select')![0][0]).toMatchObject({ sessionId: baseAgent.sessionId })
  })

  it('names the agent by its pipeline task when it has one', () => {
    expect(render({ pipelineTaskTitle: 'Fix login redirect' }).get('[data-testid="agent-card-title"]').text()).toBe('Fix login redirect')
  })
})

describe('agentCard — compact worker (3G)', () => {
  it('shows no transcript, subagent output, PID or path', () => {
    const html = render({ subagents: [activeSubagent] }).html()
    for (const hidden of ['TRANSCRIPT', 'SUBAGENT OUTPUT', String(baseAgent.pid), '/home/user', 'secret-client'])
      expect(html).not.toContain(hidden)
  })

  it('has no fixed height, so nothing it shows is clipped', () => {
    const card = render().get('[data-testid="agent-card"]')
    expect(card.classes().join(' ')).not.toMatch(/\bh-\[\d+px\]/)
  })

  it('counts active subagents instead of listing them', () => {
    const w = render({ subagents: [activeSubagent, { ...activeSubagent, id: 'sa-2' }, { ...activeSubagent, id: 'sa-3', status: 'completed' }] })
    expect(w.get('[data-testid="agent-card-facts"]').text()).toContain('2 subagents')
    expect(w.find('[data-testid="active-subagents-block"]').exists()).toBe(false)
  })

  it('names an open tool call by tool only while working', () => {
    const w = render({ working: true, pendingToolUse: { id: 't', tool: 'Bash', pattern: 'rm -rf /tmp/cache', patternDisplay: 'rm -rf /tmp/cache' } })
    expect(w.get('[data-testid="agent-card-activity"]').text()).toBe('Using Bash')
    expect(w.html()).not.toContain('rm -rf')
  })

  it('says what the agent last used when it is not working', () => {
    expect(render({ currentAction: 'Read' }).get('[data-testid="agent-card-activity"]').text()).toBe('Last tool Read')
    expect(render({ currentAction: undefined, lastTools: [] }).get('[data-testid="agent-card-activity"]').text()).toBe('No tool used yet')
  })

  it('shows role, last activity and cost as facts', () => {
    const w = render({ spawnerName: 'Reviewer' })
    expect(w.get('[data-testid="agent-card-facts"]').text()).toMatch(/Reviewer · \d+s ago/)
    expect(w.get('[data-testid="agent-card-cost"]').text()).toBe('$1.25')
  })

  it('moves tokens and health into the metrics popover', async () => {
    const w = render()
    expect(w.text()).not.toContain('tok')
    await w.get('[data-testid="agent-card-info"]').trigger('click')
    expect(w.get('[data-testid="metrics-tokens"]').text()).toContain('1.5k')
    expect(w.get('[data-testid="metrics-health"]').text()).toContain('80/100')
  })
})

describe('agentCard — attention (canonical, passed in)', () => {
  it('shows nothing without an attention item', () => {
    expect(render().find('[data-testid="agent-card-attention"]').exists()).toBe(false)
  })

  it('marks a blocked agent quietly, in amber, with the reason for assistive tech', () => {
    const chip = render({}, item('blocking', 'Permission request waiting')).get('[data-testid="agent-card-attention"]')
    expect(chip.text()).toContain('Needs you')
    expect(chip.classes()).toContain('text-warning-text')
    expect(chip.get('.sr-only').text()).toContain('Permission request waiting')
  })

  it('marks a failed agent in red', () => {
    const chip = render({}, item('failed', 'API error reported: Rate limited')).get('[data-testid="agent-card-attention"]')
    expect(chip.text()).toContain('Failed')
    expect(chip.classes()).toContain('text-danger-text')
  })

  it('never moves the whole card', () => {
    const card = render({ working: true }, item('blocking', 'Question waiting for your answer')).get('[data-testid="agent-card"]')
    expect(card.classes().join(' ')).not.toMatch(/motion-|animate-/)
  })
})

describe('agentCard working badge', () => {
  it('shows Working badge when agent.working, overriding status', () => {
    const w = mount(AgentCard, { props: { agent: { ...baseAgent, status: 'waiting', working: true } }, global: { stubs } })
    expect(w.text()).toContain('Working')
    expect(w.text()).not.toContain('Waiting')
  })

  it('shows the "Quiet" label (not the ambiguous "Waiting") when not working', () => {
    const w = mount(AgentCard, { props: { agent: { ...baseAgent, status: 'waiting', working: false } }, global: { stubs } })
    expect(w.text()).toContain('Quiet')
    expect(w.text()).not.toContain('Waiting')
  })
})

describe('agentCard finished state', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows no dismiss button for a live agent', () => {
    expect(render({ status: 'active' }).find('[data-testid="agent-card-dismiss"]').exists()).toBe(false)
  })

  it('shows a dismiss button for a finished agent', () => {
    const w = render({ status: 'finished' })
    expect(w.find('[data-testid="agent-card-dismiss"]').exists()).toBe(true)
    expect(w.get('[data-testid="agent-card-activity"]').text()).toBe('Finished')
  })

  it('calls the DELETE endpoint and emits dismiss on click', async () => {
    const w = render({ pid: 4242, status: 'finished' })
    await w.get('[data-testid="agent-card-dismiss"]').trigger('click')
    expect(fetch).toHaveBeenCalledWith('/api/agents/4242/channel', expect.objectContaining({ method: 'DELETE' }))
    expect(w.emitted('dismiss')?.[0]).toEqual([4242])
  })
})

describe('agentCard your-turn marker', () => {
  it('marks a live agent that stopped on its own', () => {
    expect(render({ status: 'idle', working: false }).get('[data-testid="agent-awaiting-input"]').text()).toBe('your turn')
  })

  it('shows nothing while the agent is working', () => {
    expect(render({ status: 'active', working: true }).find('[data-testid="agent-awaiting-input"]').exists()).toBe(false)
  })

  it('shows nothing for a finished agent — there is nothing to continue', () => {
    expect(render({ status: 'finished', working: false }).find('[data-testid="agent-awaiting-input"]').exists()).toBe(false)
  })
})

describe('agentCard internal process badge', () => {
  it('shows the internal-process badge when agent.internalProcess is true', () => {
    expect(render({ internalProcess: true }).find('[data-testid="agent-card-internal-badge"]').exists()).toBe(true)
  })

  it('hides the internal-process badge for a normal session', () => {
    expect(render({ internalProcess: false }).find('[data-testid="agent-card-internal-badge"]').exists()).toBe(false)
  })
})

describe('agentCard terminal access', () => {
  // AppModal teleports to <body>, so the overlay is asserted through the document.
  it('offers a terminal for a live-injectable agent', async () => {
    const w = mount(AgentCard, {
      props: { agent: { ...baseAgent, liveInjectable: true } },
      global: { stubs },
      attachTo: document.body,
    })
    expect(document.querySelector('[data-testid="agent-terminal-modal"]')).toBeNull()
    await w.get('[data-testid="agent-card-terminal"]').trigger('click')
    expect(document.querySelector('[data-testid="agent-terminal-modal"]')).not.toBeNull()
    w.unmount()
    document.body.innerHTML = ''
  })

  it('offers none when the session cannot be driven', () => {
    expect(render({ liveInjectable: false }).find('[data-testid="agent-card-terminal"]').exists()).toBe(false)
  })
})

describe('agentCard — workspace identity', () => {
  const inWorkspace = (over: Record<string, unknown>): Partial<Agent> => ({
    projectName: 'Agent-Dashboard',
    workspace: {
      id: 'ws_main',
      name: 'Agent-Dashboard',
      kind: 'git-main',
      branch: 'feat/localscope-integration',
      repository: { id: 'repo_shared', name: 'Agent-Dashboard' },
      ...over,
    },
  } as Partial<Agent>)

  it('names the repository and makes two worktrees of it visibly distinguishable', () => {
    const main = render(inWorkspace({}))
    const worktree = render(inWorkspace({ id: 'ws_wt', kind: 'git-worktree', branch: 'feat/ui-redesign' }))
    expect(main.get('[data-testid="agent-card-repository"]').text()).toBe('Agent-Dashboard')
    expect(worktree.get('[data-testid="agent-card-repository"]').text()).toBe('Agent-Dashboard')
    expect(main.text()).toContain('feat/localscope-integration')
    expect(worktree.text()).toContain('feat/ui-redesign')
    expect(worktree.text()).toContain('worktree')
    expect(main.text()).not.toContain('feat/ui-redesign')
  })

  it('says the workspace is unknown instead of guessing one from the folder', () => {
    const w = render({ workspace: null })
    expect(w.get('[data-testid="agent-card-workspace-unknown"]').text()).toBe('Workspace unknown')
    expect(w.find('[data-testid="workspace-branch"]').exists()).toBe(false)
    expect(w.text()).not.toContain('my-project')
  })

  it('exposes no filesystem path through the workspace badge', () => {
    const badge = render(inWorkspace({})).get('[data-workspace-id]')
    expect(badge.html()).not.toContain('.git')
    expect(badge.html()).not.toContain('/home/user')
  })
})

describe('agentCard — accessibility', () => {
  it('has no axe violations with attention, workspace and actions present', async () => {
    const w = mount(AgentCard, {
      props: {
        agent: { ...baseAgent, liveInjectable: true, working: true, workspace: { id: 'ws', name: 'web', kind: 'git-main', branch: 'main', repository: { id: 'r', name: 'web' } } } as Agent,
        attention: item('blocking', 'Question waiting for your answer'),
      },
      global: { stubs },
      attachTo: document.body,
    })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})

describe('agentCard — metrics popover (3I)', () => {
  const wrap = (w: ReturnType<typeof render>) => w.get('[data-testid="agent-card-metrics"]')
  const isOpen = (w: ReturnType<typeof render>) => w.find('[data-testid="metrics-popover"]').exists()

  // G: the click a pointer user makes while hovering must not close what hover opened.
  it('keeps the popover open when it is clicked while hovered, and closes it on a second click', async () => {
    const w = render()
    await wrap(w).trigger('mouseenter')
    expect(isOpen(w)).toBe(true)
    await w.get('[data-testid="agent-card-info"]').trigger('click')
    expect(isOpen(w)).toBe(true)
    await wrap(w).trigger('mouseleave')
    expect(isOpen(w)).toBe(true)
    await w.get('[data-testid="agent-card-info"]').trigger('click')
    expect(isOpen(w)).toBe(false)
  })

  it('closes a hover preview when the pointer leaves, and opening it never opens the agent', async () => {
    const w = render()
    await wrap(w).trigger('mouseenter')
    await wrap(w).trigger('mouseleave')
    expect(isOpen(w)).toBe(false)
    await w.get('[data-testid="agent-card-info"]').trigger('click')
    expect(w.emitted('select')).toBeFalsy()
  })

  // H: keyboard.
  it('opens on focus, reports its state, closes on Escape and when focus leaves', async () => {
    const w = render()
    const info = w.get('[data-testid="agent-card-info"]')
    await wrap(w).trigger('focusin')
    expect(isOpen(w)).toBe(true)
    expect(info.attributes('aria-expanded')).toBe('true')
    await wrap(w).trigger('keydown', { key: 'Escape' })
    expect(isOpen(w)).toBe(false)
    expect(info.attributes('aria-expanded')).toBe('false')

    await wrap(w).trigger('focusin')
    await info.trigger('click')
    await wrap(w).trigger('focusout', { relatedTarget: null })
    expect(isOpen(w)).toBe(false)
  })
})
