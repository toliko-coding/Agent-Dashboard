import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { axe } from '@/utils/testA11y'
import ActiveWork from './ActiveWork.vue'

function repoWs(id: string, repoId: string, o: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return { id, name: 'web', kind: 'git-main', branch: 'main', repository: { id: repoId, name: 'web' }, ...o }
}

let n = 0
function agent(o: Partial<Agent>): Agent {
  n++
  return {
    pid: 7000 + n,
    sessionId: `${n}a2b3c4d-0000-4000-8000-000000000000`,
    provider: 'claude',
    status: 'active',
    working: true,
    projectName: 'secret-client',
    projectPath: '/Users/someone/secret-client/web',
    cwd: '/Users/someone/secret-client/web',
    lastActivity: new Date(Date.now() - 20_000).toISOString(),
    lastOutput: 'TRANSCRIPT: deploy key abc',
    model: 'claude-sonnet-5',
    subagents: [],
    workspace: null,
    ...o,
  } as Agent
}

let wrappers: { unmount: () => void }[] = []
function render(agents: Agent[], o: Partial<{ status: 'loading' | 'ready', stale: boolean, totalAgents: number }> = {}) {
  const w = mount(ActiveWork, { props: { agents, status: 'ready', stale: false, totalAgents: agents.length, ...o }, attachTo: document.body })
  wrappers.push(w)
  return w
}
afterEach(() => {
  wrappers.forEach(w => w.unmount())
  wrappers = []
})

describe('activeWork — grouping', () => {
  it('shows a working agent as an operational row under its repository and workspace', () => {
    const w = render([agent({ workspace: repoWs('ws-1', 'repo-a'), pipelineTaskTitle: 'Fix login redirect' })])
    expect(w.get('h2').text()).toBe('Active work')
    expect(w.get('[data-testid="active-work-count"]').text()).toBe('1 working')
    expect(w.get('[data-testid="active-work-repository"]').text()).toBe('web')
    expect(w.get('[data-testid="active-work-branch"]').text()).toBe('main')
    expect(w.get('[data-testid="active-work-title"]').text()).toBe('Fix login redirect')
  })

  it('keeps two repositories that share a name as two frames', () => {
    const w = render([agent({ workspace: repoWs('ws-1', 'repo-a') }), agent({ workspace: repoWs('ws-2', 'repo-b') })])
    const frames = w.findAll('[data-testid="active-work-group"][data-kind="repository"]')
    expect(frames).toHaveLength(2)
    expect(frames.map(f => f.attributes('data-group-key'))).toEqual(['repository:repo-a', 'repository:repo-b'])
    expect(frames.map(f => f.get('[data-testid="active-work-repository"]').text())).toEqual(['web', 'web'])
  })

  it('keeps a worktree as its own workspace inside the same repository', () => {
    const w = render([
      agent({ workspace: repoWs('ws-main', 'repo-a') }),
      agent({ workspace: repoWs('ws-wt', 'repo-a', { kind: 'git-worktree', branch: 'feat/x', name: 'web-feat-x' }) }),
    ])
    expect(w.findAll('[data-testid="active-work-group"]')).toHaveLength(1)
    const workspaces = w.findAll('[data-testid="active-work-workspace"]')
    expect(workspaces.map(ws => ws.attributes('data-workspace-kind'))).toEqual(['git-main', 'git-worktree'])
    expect(workspaces[1].text()).toContain('worktree')
  })

  it('puts an unresolved workspace in a neutral frame instead of guessing one', () => {
    const w = render([agent({ workspace: null })])
    const frame = w.get('[data-testid="active-work-group"]')
    expect(frame.attributes('data-kind')).toBe('unknown')
    expect(frame.text()).toContain('Workspace unknown')
    expect(frame.classes()).toContain('border-dashed')
    expect(frame.html()).not.toMatch(/danger|warning/)
  })
})

describe('activeWork — rows', () => {
  it('names an open tool call by tool only and moves the state dot while live', () => {
    const w = render([agent({ workspace: repoWs('ws-1', 'repo-a'), pendingToolUse: { id: 't', tool: 'Bash', pattern: 'rm -rf /tmp/scratch', patternDisplay: 'rm -rf /tmp/scratch' } })])
    const row = w.get('[data-testid="active-work-agent"]')
    expect(row.attributes('data-state')).toBe('tool')
    expect(row.get('[data-testid="active-work-activity"]').text()).toBe('Using Bash')
    expect(row.get('[data-testid="active-work-dot"]').classes()).toContain('motion-tool')
  })

  it('stills the state dot for last-known rows while agent updates reconnect', () => {
    const w = render([agent({ workspace: repoWs('ws-1', 'repo-a') })], { stale: true })
    expect(w.get('[data-testid="active-work-dot"]').classes().join(' ')).not.toMatch(/motion-/)
    expect(w.get('[data-testid="active-work-stale"]').text()).toContain('reconnecting')
  })

  it('emits the agent to open its existing details', async () => {
    const a = agent({ workspace: repoWs('ws-1', 'repo-a') })
    const w = render([a])
    await w.get('[data-testid="active-work-agent"]').trigger('click')
    expect(w.emitted('select')).toEqual([[a]])
  })

  it('shows no PID, path, transcript, folder name or command', () => {
    const a = agent({ workspace: repoWs('ws-1', 'repo-a'), pendingToolUse: { id: 't', tool: 'Bash', pattern: 'cat ~/.ssh/id_rsa', patternDisplay: 'cat ~/.ssh/id_rsa' } })
    const html = render([a]).html()
    for (const secret of [String(a.pid), '/Users/someone', 'secret-client', 'TRANSCRIPT', 'id_rsa'])
      expect(html).not.toContain(secret)
  })
})

describe('activeWork — states', () => {
  it('does not claim nobody is working before agents are known', () => {
    const w = render([], { status: 'loading', totalAgents: 0 })
    expect(w.find('[data-testid="active-work-loading"]').exists()).toBe(true)
    expect(w.find('[data-testid="active-work-empty"]').exists()).toBe(false)
  })

  it('says plainly when no agent is working', () => {
    const w = render([], { totalAgents: 3 })
    expect(w.get('[data-testid="active-work-empty"]').text()).toBe('No agent is working right now. 3 agents are running but not working.')
  })

  it('has no axe violations', async () => {
    const w = render([
      agent({ workspace: repoWs('ws-1', 'repo-a') }),
      agent({ workspace: repoWs('ws-wt', 'repo-a', { kind: 'git-worktree', branch: 'feat/x' }) }),
      agent({ workspace: null }),
    ])
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })
})

describe('activeWork — presentation (3N)', () => {
  it('counts the working agents that are using a tool', () => {
    const tool = { id: 't', tool: 'Edit', pattern: '', patternDisplay: '' }
    const w = render([agent({ workspace: repoWs('w1', 'r1'), pendingToolUse: tool }), agent({ workspace: repoWs('w1', 'r1') })])
    expect(w.get('[data-testid="active-work-count"]').text()).toBe('2 working')
    expect(w.get('[data-testid="active-work-tools"]').text()).toBe('· 1 using tools')
    expect(w.get('[data-testid="active-work-group-count"]').text()).toBe('2 working')
  })

  it('marks each row with its icon and the process uptime, never a turn duration', () => {
    const w = render([agent({ workspace: repoWs('w1', 'r1'), uptime: 7260, liveInjectable: true, category: 'data' })])
    expect(w.get('[data-testid="active-work-agent"] [data-testid="agent-glyph"]').attributes('aria-label')).toBe('Data & trading agent')
    expect(w.get('[data-testid="active-work-facts"]').text()).toContain('up 2h 1m')
  })

  // M: Command names an agent exactly as the Agents view does.
  it('names an agent by its given name, with the session title as its topic and the handle beside it', () => {
    const w = render([agent({ workspace: repoWs('w1', 'r1'), displayName: 'WalletRadar', title: 'Backtest the momentum strategy' })])
    expect(w.get('[data-testid="active-work-title"]').text()).toBe('WalletRadar')
    expect(w.get('[data-testid="active-work-topic"]').text()).toBe('Backtest the momentum strategy')
    expect(w.get('[data-testid="active-work-handle"]').text()).toMatch(/^Claude · [0-9a-f]{8}$/)
  })

  it('uses the session title as the name when none was given, and does not repeat it', () => {
    const w = render([agent({ workspace: repoWs('w1', 'r1'), title: 'Fix login redirect' })])
    expect(w.get('[data-testid="active-work-title"]').text()).toBe('Fix login redirect')
    expect(w.find('[data-testid="active-work-topic"]').exists()).toBe(false)
  })
})
