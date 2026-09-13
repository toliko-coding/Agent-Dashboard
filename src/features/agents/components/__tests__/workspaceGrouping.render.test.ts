import type { Agent, WorkspaceRef } from '@/types'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupAgents } from '@/utils/agentGroup'
import AgentCardGrid from '../AgentCardGrid.vue'
import AgentTable from '../AgentTable.vue'

/*
 * The nested rendering, in both roster layouts. Cards and rows are stubbed so
 * these assert the STRUCTURE the grouping produces and nothing else.
 */

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

beforeEach(() => {
  const storage = memoryStorage()
  // Stored, empty collapse state: every group open, so structure is visible.
  storage.setItem('agent-dashboard-collapsed-groups:workspace', '[]')
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => vi.unstubAllGlobals())

let nextPid = 100
function agent(workspace: WorkspaceRef | null): Agent {
  nextPid++
  return { pid: nextPid, sessionId: `s${nextPid}`, projectName: 'Agent-Dashboard', costEstimate: 1, workspace } as unknown as Agent
}
function ws(id: string, over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id,
    name: 'Agent-Dashboard',
    kind: 'git-main',
    branch: 'feat/localscope-integration',
    repository: { id: 'repo_ad', name: 'Agent-Dashboard' },
    ...over,
  } as WorkspaceRef
}

function scenario() {
  return [
    agent(ws('ws_main')),
    agent(ws('ws_wt', { kind: 'git-worktree', branch: 'tmp/2df-verify', name: '2df-verify' })),
    agent(ws('ws_ls', { branch: 'feat/development-sessions', name: 'LocalScope', repository: { id: 'repo_ls', name: 'LocalScope' } })),
    agent(ws('ws_plain', { kind: 'plain', branch: '', name: 'notes', repository: null })),
    agent(null),
  ]
}

function headerTexts(w: ReturnType<typeof mount>) {
  return w.findAll('[data-testid="group-header-toggle"]').map(h => h.text())
}

describe('agentCardGrid — repository & workspace', () => {
  function mountGrid(list: Agent[]) {
    return mount(AgentCardGrid, {
      props: { agents: list, groups: groupAgents(list, 'workspace'), groupBy: 'workspace' },
      global: { stubs: { AgentCard: true } },
    })
  }

  it('shows one repository with two workspaces, not two repositories', () => {
    const w = mountGrid(scenario())
    const headers = headerTexts(w)
    expect(headers.filter(t => t.includes('Agent-Dashboard'))).toHaveLength(1)

    const repo = w.findAll('[data-testid="group-workspaces"]')[0]
    const rows = repo.findAll('[data-testid="workspace-group-row"]')
    expect(rows.map(r => r.attributes('data-workspace-id'))).toEqual(['ws_main', 'ws_wt'])
    expect(rows[0].text()).toContain('feat/localscope-integration')
    expect(rows[1].text()).toContain('tmp/2df-verify')
    expect(rows[1].text()).toContain('worktree')
  })

  it('announces the repository and its workspace count in the header', () => {
    const w = mountGrid(scenario())
    const header = w.findAll('[data-testid="group-header-toggle"]')
      .find(h => h.text().includes('Agent-Dashboard'))!
    expect(header.get('[data-testid="group-header-prefix"]').text()).toBe('Repository')
    expect(header.get('[data-testid="group-header-detail"]').text()).toBe('2 workspaces')
    expect(header.attributes('aria-label')).toBe('Toggle Repository Agent-Dashboard group')
  })

  it('keeps a single-workspace repository compact: a header and one row, no count', () => {
    const w = mountGrid(scenario())
    const header = w.findAll('[data-testid="group-header-toggle"]')
      .find(h => h.text().includes('LocalScope'))!
    expect(header.find('[data-testid="group-header-detail"]').exists()).toBe(false)
  })

  it('renders every agent card once', () => {
    const list = scenario()
    const w = mountGrid(list)
    expect(w.findAll('agent-card-stub')).toHaveLength(list.length)
  })

  it('shows a plain workspace under Local workspaces', () => {
    const w = mountGrid(scenario())
    expect(headerTexts(w).some(t => t.includes('Local workspaces'))).toBe(true)
    const plainRow = w.findAll('[data-testid="workspace-group-row"]')
      .find(r => r.attributes('data-workspace-kind') === 'plain')!
    expect(plainRow.text()).toContain('not a Git repository')
  })

  it('shows an unidentified agent under Workspace unknown, neutrally', () => {
    const w = mountGrid(scenario())
    const header = w.findAll('[data-testid="group-header-toggle"]')
      .find(h => h.text().includes('Workspace unknown'))!
    expect(header.exists()).toBe(true)
    expect(header.html()).not.toMatch(/danger|state-error/)
  })

  it('leaves an existing grouping mode single-level', () => {
    const list = scenario()
    const w = mount(AgentCardGrid, {
      props: { agents: list, groups: groupAgents(list, 'status'), groupBy: 'status' },
      global: { stubs: { AgentCard: true } },
    })
    expect(w.find('[data-testid="workspace-group-row"]').exists()).toBe(false)
    expect(w.find('[data-testid="group-header-prefix"]').exists()).toBe(false)
  })
})

describe('agentTable — repository & workspace', () => {
  function mountTable(list: Agent[]) {
    return mount(AgentTable, {
      props: { agents: list, groups: groupAgents(list, 'workspace') },
      global: { stubs: { AgentRow: true } },
    })
  }

  it('nests workspaces under their repository in the list layout too', () => {
    const w = mountTable(scenario())
    expect(headerTexts(w).filter(t => t.includes('Agent-Dashboard'))).toHaveLength(1)
    const ids = w.findAll('[data-testid="workspace-group-row"]').map(r => r.attributes('data-workspace-id'))
    expect(ids).toEqual(['ws_main', 'ws_wt', 'ws_ls', 'ws_plain'])
  })

  it('renders every agent row once', () => {
    const list = scenario()
    expect(mountTable(list).findAll('agent-row-stub')).toHaveLength(list.length)
  })
})
