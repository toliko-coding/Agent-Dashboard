import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { agentTitle } from '@/utils/agentLabels'
import { axe } from '@/utils/testA11y'
import TerminalView from './TerminalView.vue'

const selectAgent = vi.fn()
const agents = ref<Agent[]>([])

vi.mock('@/features/agents', () => ({
  useAgents: () => ({ agents, selectAgent }),
}))

function agent(over: Partial<Agent>): Agent {
  return {
    pid: 4242,
    sessionId: 'abcdef0123456789',
    provider: 'claude',
    projectName: 'secret-folder',
    projectPath: '/Users/x/secret-folder',
    cwd: '/Users/x/secret-folder',
    status: 'active',
    working: false,
    liveInjectable: true,
    workspace: { id: 'ws1', name: 'app-wt', kind: 'git-worktree', branch: 'feat/x', repository: { id: 'r1', name: 'app' } },
    ...over,
  } as unknown as Agent
}

describe('terminalView (3L)', () => {
  it('lists attachable agents by canonical name and workspace — no folder, path or PID', () => {
    const a = agent({})
    agents.value = [a, agent({ sessionId: 'nope', liveInjectable: false })]
    const w = mount(TerminalView)
    const rows = w.findAll('[data-testid="terminal-agent"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain(agentTitle(a))
    expect(rows[0].get('[data-testid="terminal-agent-where"]').text()).toBe('app · feat/x · worktree')
    expect(w.html()).not.toContain('secret-folder')
    expect(w.html()).not.toContain('/Users/')
    expect(w.text()).not.toContain('4242')
  })

  it('says Workspace unknown rather than guessing', () => {
    agents.value = [agent({ workspace: null })]
    expect(mount(TerminalView).get('[data-testid="terminal-agent-where"]').text()).toBe('Workspace unknown')
  })

  it('opens the agent\'s details, where its terminal action lives', async () => {
    const a = agent({})
    agents.value = [a]
    await mount(TerminalView).get('[data-testid="terminal-agent"]').trigger('click')
    expect(selectAgent).toHaveBeenCalledWith(a)
  })

  it('has no axe violations', async () => {
    agents.value = [agent({})]
    const w = mount(TerminalView, { attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
