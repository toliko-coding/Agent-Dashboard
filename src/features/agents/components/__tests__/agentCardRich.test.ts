import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'

// 3N.2: the rich operational card shows only real information.

const openInEditor = vi.fn(() => true)
vi.mock('@/composables/useAgentLifecycle', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/composables/useAgentLifecycle')>()
  return { ...real, openInEditor }
})

const base = {
  pid: 918273,
  sessionId: '5d0ab190-0000-4000-8000-000000000000',
  provider: 'claude',
  projectPath: '/Users/someone/secret-client/portfolio',
  projectName: 'portfolio',
  cwd: '/Users/someone/secret-client/portfolio',
  entrypoint: 'cli',
  status: 'active',
  uptime: 17_280,
  lastActivity: new Date().toISOString(),
  lastTools: [{ name: 'Bash', detail: 'rm -rf ./dist && pnpm build' }],
  tasks: [],
  subagents: [],
  tokenUsage: { inputTokens: 9_000, outputTokens: 4_120, cacheCreationTokens: 0, cacheReadTokens: 0 },
  costEstimate: 75.66,
  cacheCreationCostEstimate: 0,
  cacheReadCostEstimate: 0,
  healthScore: 90,
  conversationTurns: 12,
  toolCounts: { Bash: 12, Edit: 8, Read: 5, Grep: 1, Glob: 1 },
  channelAvailable: true,
  working: false,
  permissionsBypassed: false,
  convergenceAlert: false,
  workspace: { id: 'ws', name: 'portfolio', kind: 'git-main', branch: 'main', repository: { id: 'r', name: 'Portfolio' } },
  displayName: 'Portfolio',
  category: 'web',
  title: 'Refactoring responsive navigation',
  model: 'claude-opus-5',
  lastOutput: 'TRANSCRIPT: here is the deploy key',
  pendingToolUse: undefined,
} as unknown as Agent

const stubs = { MachineBadge: true, ProviderBadge: true, AgentServiceChips: true }

async function render(o: Partial<Agent> = {}, attach = false) {
  const { default: AgentCard } = await import('../AgentCard.vue')
  return mount(AgentCard, { props: { agent: { ...base, ...o } as Agent }, global: { stubs }, attachTo: attach ? document.body : undefined })
}

afterEach(async () => {
  const { useAgentLifecycle } = await import('@/composables/useAgentLifecycle')
  useAgentLifecycle().cancel()
  openInEditor.mockClear()
})

describe('rich agent card — instruments from real values only', () => {
  it('shows uptime, recent tool calls, tokens and estimated cost', async () => {
    const w = await render()
    expect(w.get('[data-testid="agent-card-uptime"]').text()).toBe('4h 48m')
    expect(w.get('[data-testid="agent-card-tools"]').text()).toBe('27')
    expect(w.get('[data-testid="agent-card-tokens"]').text()).toBe('13.1k')
    expect(w.get('[data-testid="agent-card-cost"]').text()).toBe('$75.66')
  })

  it('says a value is missing rather than inventing one', async () => {
    const w = await render({ status: 'finished', uptime: 0, toolCounts: {}, costUnknown: true, tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } })
    expect(w.get('[data-testid="agent-card-uptime"]').text()).toBe('—')
    expect(w.get('[data-testid="agent-card-tools"]').text()).toBe('—')
    expect(w.get('[data-testid="agent-card-tokens"]').text()).toBe('—')
    expect(w.get('[data-testid="agent-card-cost"]').text()).toBe('Unknown')
    expect(w.find('[data-testid="agent-card-tool-mix"]').exists()).toBe(false)
  })

  it('draws the tool mix from the tool counts, with the same numbers in words', async () => {
    const mix = (await render()).get('[data-testid="agent-card-tool-mix"]')
    expect(mix.text()).toContain('Bash 12 · Edit 8 · Read 5 · other 2')
  })

  it('draws no tool mix for a single tool — a one-segment bar says nothing', async () => {
    const w = await render({ toolCounts: { Bash: 3 } })
    expect(w.find('[data-testid="agent-card-tool-mix"]').exists()).toBe(false)
    expect(w.get('[data-testid="agent-card-tools"]').text()).toBe('3')
  })

  it('reads a session\'s billions of tokens as billions', async () => {
    const w = await render({ tokenUsage: { inputTokens: 1_000_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 977_250_000 } })
    expect(w.get('[data-testid="agent-card-tokens"]').text()).toBe('1.98B')
  })

  it('shows files and lines changed only when Claude wrote session meta', async () => {
    expect((await render({ meta: undefined })).text()).not.toMatch(/files? changed/)
    const w = await render({ meta: { inputTokens: 0, outputTokens: 0, linesAdded: 40, linesRemoved: 12, filesModified: 5, gitCommits: 0, toolErrors: 0, usesMcp: false, firstPrompt: 'SECRET PROMPT' } })
    expect(w.get('[data-testid="agent-card-chips"]').text()).toContain('5 files changed')
    expect(w.get('[data-testid="agent-card-chips"]').text()).toContain('+40 −12')
    expect(w.text()).not.toContain('SECRET PROMPT')
    expect(w.text()).not.toMatch(/commit/)
  })
})

describe('rich agent card — privacy', () => {
  it('shows no path, command, tool arguments, transcript or PID', async () => {
    const html = (await render({ working: true, pendingToolUse: { id: 't', tool: 'Bash', pattern: 'cat ~/.aws/credentials', patternDisplay: 'cat ~/.aws/credentials' } })).html()
    for (const hidden of ['/Users/someone', 'secret-client', 'rm -rf', 'credentials', 'TRANSCRIPT', '918273', 'vscode://'])
      expect(html).not.toContain(hidden)
  })

  it('reads the working folder only when Open in the editor is clicked', async () => {
    const w = await render()
    await w.get('[data-testid="agent-card-editor"]').trigger('click')
    expect(openInEditor).toHaveBeenCalledWith('/Users/someone/secret-client/portfolio')
    expect(w.emitted('select')).toBeFalsy()
  })
})

describe('rich agent card — state and motion', () => {
  it('keeps an idle card quiet: no edge, no motion', async () => {
    const w = await render({ status: 'idle', working: false })
    expect(w.find('[data-testid="agent-card-edge"]').exists()).toBe(false)
    expect(w.html()).not.toMatch(/motion-|cc-frame-/)
  })

  it('moves only the edge while working, and sweeps it while a tool call is open', async () => {
    const working = await render({ working: true })
    expect(working.get('[data-testid="agent-card-energy"]').classes()).toContain('motion-energy')
    expect(working.get('[data-testid="agent-card"]').classes()).toContain('cc-frame-working')
    expect(working.get('[data-testid="agent-card"]').classes().join(' ')).not.toMatch(/motion-/)

    const tool = await render({ working: true, pendingToolUse: { id: 't', tool: 'Edit', pattern: '', patternDisplay: '' } })
    expect(tool.get('[data-testid="agent-card-sweep"]').classes()).toContain('motion-sweep')
    expect(tool.find('[data-testid="agent-card-energy"]').exists()).toBe(false)
  })

  it('holds every motion still while agent updates reconnect', async () => {
    const { default: AgentCard } = await import('../AgentCard.vue')
    const w = mount(AgentCard, { props: { agent: { ...base, working: true } as Agent, stale: true }, global: { stubs } })
    expect(w.html()).not.toMatch(/motion-/)
  })

  it('shows a Needs you reason with Review, which opens the agent', async () => {
    const { default: AgentCard } = await import('../AgentCard.vue')
    const attention = { id: 'a', level: 'blocking', kind: 'permission', subject: { type: 'agent', sessionId: base.sessionId }, agentSessionId: base.sessionId, workspace: null, repository: null, title: '', reason: 'Permission request waiting', since: null, lastActivity: null } as const
    const w = mount(AgentCard, { props: { agent: base, attention }, global: { stubs } })
    const panel = w.get('[data-testid="agent-card-attention-panel"]')
    expect(panel.text()).toContain('Permission request waiting')
    await w.get('[data-testid="agent-card-review"]').trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
  })
})

describe('rich agent card — actions', () => {
  it('asks the shared confirmation to stop or delete, and never acts directly', async () => {
    const { useAgentLifecycle } = await import('@/composables/useAgentLifecycle')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const w = await render()
    await w.get('[data-testid="agent-card-stop"]').trigger('click')
    expect(useAgentLifecycle().pending.value).toMatchObject({ action: 'stop' })
    await w.get('[data-testid="agent-card-delete"]').trigger('click')
    expect(useAgentLifecycle().pending.value).toMatchObject({ action: 'delete' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(w.emitted('select')).toBeFalsy()
    vi.unstubAllGlobals()
  })

  it('offers neither Stop nor Delete for Claude Code internal processes', async () => {
    const w = await render({ internalProcess: true })
    expect(w.find('[data-testid="agent-card-stop"]').exists()).toBe(false)
    expect(w.find('[data-testid="agent-card-delete"]').exists()).toBe(false)
  })

  it('has no axe violations', async () => {
    const w = await render({ working: true, meta: { inputTokens: 0, outputTokens: 0, linesAdded: 1, linesRemoved: 1, filesModified: 1, gitCommits: 1, toolErrors: 0, usesMcp: false, firstPrompt: '' } }, true)
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
