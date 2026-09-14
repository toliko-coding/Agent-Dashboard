import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AgentRow from '@/features/agents/components/AgentRow.vue'
import { agentTitle } from '@/utils/agentLabels'
import ActiveWork from '../ActiveWork.vue'

/*
 * J + K (3M): an agent started with Project = None carries no project at all —
 * the Agent model has no project field — and every surface names it, states it
 * and places it by workspace identity, without an "Unknown Project".
 */

vi.mock('@/features/agents/composables/useAgentIdentity', () => ({
  useAgentIdentity: () => ({ getIdentity: () => ({ emoji: '🤖' }) }),
}))

const PLAIN: WorkspaceRef = { id: 'ws_plain', name: 'scratch-plain', kind: 'plain', branch: '', repository: null } as WorkspaceRef
const REPO: WorkspaceRef = { id: 'ws_repo', name: 'local-repo', kind: 'git-main', branch: 'main', repository: { id: 'repo_local', name: 'local-repo' } } as WorkspaceRef

function agent(sessionId: string, workspace: WorkspaceRef | null, working = true): Agent {
  return {
    pid: 10,
    sessionId,
    provider: 'claude',
    projectName: 'scratch-plain',
    projectPath: '/Users/me/scratch-plain',
    cwd: '/Users/me/scratch-plain',
    status: 'active',
    working,
    model: 'claude-opus-5',
    uptime: 30,
    lastActivity: new Date().toISOString(),
    lastTools: [],
    tasks: [],
    subagents: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
    costEstimate: 0,
    workspace,
  } as unknown as Agent
}

describe('a projectless agent', () => {
  it('renders in the Agents list with its name, state and plain workspace (J)', () => {
    const a = agent('11111111-aaaa', PLAIN)
    const w = mount(AgentRow, { props: { agent: a } })
    expect(w.text()).toContain(agentTitle(a))
    expect(w.get('[data-testid="agent-row"]').attributes('data-state')).toBe('working')
    expect(w.get('[data-testid="agent-row-local-workspace"]').text()).toContain('scratch-plain')
    expect(w.text()).not.toMatch(/unknown project|project/i)
  })

  it('renders in the Agents list with its local repository and branch (J)', () => {
    const w = mount(AgentRow, { props: { agent: agent('22222222-bbbb', REPO) } })
    expect(w.get('[data-testid="agent-row-repository"]').text()).toBe('local-repo')
    expect(w.text()).toContain('main')
  })

  it('renders in Command\'s Active work without a project (K)', () => {
    const a = agent('33333333-cccc', PLAIN)
    const w = mount(ActiveWork, { props: { agents: [a], status: 'ready', stale: false, totalAgents: 1 } })
    expect(w.text()).toContain(agentTitle(a))
    expect(w.text()).not.toMatch(/unknown project/i)
  })
})
