import type { Agent, WorkspaceRef } from '../../types'
import { describe, expect, it } from 'vitest'
import {
  agentGroupOptions,
  groupAgents,
  groupDetail,
  groupPrefix,
  resolveGroup,
  workspaceDisplay,
} from '../agentGroup'

/*
 * Repository -> workspace grouping. The property under test throughout: groups
 * are keyed on opaque identity ids, never on anything a person reads.
 */

let nextPid = 0
function agent(workspace: WorkspaceRef | null, over: Partial<Agent> = {}): Agent {
  nextPid++
  return {
    pid: nextPid,
    sessionId: `s${nextPid}`,
    projectName: 'Agent-Dashboard',
    costEstimate: 0,
    workspace,
    ...over,
  } as unknown as Agent
}

function ws(id: string, over: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id,
    name: 'Agent-Dashboard',
    kind: 'git-main',
    branch: 'main',
    repository: { id: 'repo_ad', name: 'Agent-Dashboard' },
    ...over,
  } as WorkspaceRef
}

function leaves(groups: ReturnType<typeof groupAgents>) {
  return groups.flatMap(g => g.children ? g.children.flatMap(c => c.agents) : g.agents)
}

describe('groupAgents — repository & workspace', () => {
  it('nests two worktrees of one repository under ONE repository, as TWO workspaces', () => {
    const main = agent(ws('ws_main', { branch: 'feat/localscope-integration' }))
    const wt = agent(ws('ws_wt', { kind: 'git-worktree', branch: 'feat/ui-redesign', name: 'ui-redesign' }))
    const groups = groupAgents([main, wt], 'workspace')

    expect(groups).toHaveLength(1)
    const [repo] = groups
    expect(repo.kind).toBe('repository')
    expect(repo.label).toBe('Agent-Dashboard')
    expect(repo.children!.map(c => c.workspace!.id)).toEqual(['ws_main', 'ws_wt'])
    expect(repo.agents).toHaveLength(2)
  })

  it('keeps different repositories in different groups', () => {
    const a = agent(ws('ws_a', { repository: { id: 'repo_a', name: 'Alpha' } }))
    const b = agent(ws('ws_b', { repository: { id: 'repo_b', name: 'Beta' } }))
    const groups = groupAgents([a, b], 'workspace')
    expect(groups.map(g => g.key)).toEqual(['repository:repo_a', 'repository:repo_b'])
  })

  it('puts agents sharing a workspace id in the same workspace group', () => {
    const one = agent(ws('ws_same'))
    const two = agent(ws('ws_same'))
    const [repo] = groupAgents([one, two], 'workspace')
    expect(repo.children).toHaveLength(1)
    expect(repo.children![0].agents.map(x => x.pid)).toEqual([one.pid, two.pid])
  })

  it('places an agent with no workspace in Workspace unknown, never dropped', () => {
    const lost = agent(null)
    const found = agent(ws('ws_a'))
    const groups = groupAgents([lost, found], 'workspace')

    const unknown = groups.find(g => g.kind === 'unknown')!
    expect(unknown.label).toBe('Workspace unknown')
    expect(unknown.agents).toEqual([lost])
    expect(unknown.children).toBeUndefined()
    // The residual bucket trails the identified ones.
    expect(groups.at(-1)).toBe(unknown)
  })

  it('never attaches an unknown agent to a repository with a matching name', () => {
    // Same projectName as the identified agent — the old project grouping would
    // have merged them. Identity says it cannot be placed.
    const lost = agent(null, { projectName: 'Agent-Dashboard' })
    const found = agent(ws('ws_a'), { projectName: 'Agent-Dashboard' })
    const groups = groupAgents([found, lost], 'workspace')
    const repo = groups.find(g => g.kind === 'repository')!
    expect(repo.agents).toEqual([found])
  })

  it('gathers plain workspaces under Local workspaces, with no synthesised repository', () => {
    const plain = agent(ws('ws_plain', { kind: 'plain', branch: '', name: 'notes', repository: null }))
    const git = agent(ws('ws_git'))
    const groups = groupAgents([plain, git], 'workspace')

    const local = groups.find(g => g.kind === 'local')!
    expect(local.label).toBe('Local workspaces')
    expect(local.children!.map(c => c.workspace!.id)).toEqual(['ws_plain'])
    expect(groups.filter(g => g.kind === 'repository')).toHaveLength(1)
    expect(groups.find(g => g.kind === 'repository')!.agents).toEqual([git])
  })

  it('keeps two plain workspaces apart even though both are local', () => {
    const a = agent(ws('ws_p1', { kind: 'plain', branch: '', name: 'a', repository: null }))
    const b = agent(ws('ws_p2', { kind: 'plain', branch: '', name: 'b', repository: null }))
    const local = groupAgents([a, b], 'workspace').find(g => g.kind === 'local')!
    expect(local.children).toHaveLength(2)
  })

  /* Display names must not participate in grouping keys. */
  it('does not merge two repositories that share a name', () => {
    const a = agent(ws('ws_a', { repository: { id: 'repo_1', name: 'web' } }))
    const b = agent(ws('ws_b', { repository: { id: 'repo_2', name: 'web' } }))
    const groups = groupAgents([a, b], 'workspace')
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.label)).toEqual(['web', 'web'])
  })

  it('does not split one repository whose display name differs between agents', () => {
    const a = agent(ws('ws_a', { repository: { id: 'repo_1', name: 'first' } }))
    const b = agent(ws('ws_b', { repository: { id: 'repo_1', name: 'second' } }))
    expect(groupAgents([a, b], 'workspace')).toHaveLength(1)
  })

  it('does not group by branch name — equal branches in two repositories stay apart', () => {
    const a = agent(ws('ws_a', { branch: 'main', repository: { id: 'repo_1', name: 'x' } }))
    const b = agent(ws('ws_b', { branch: 'main', repository: { id: 'repo_2', name: 'y' } }))
    expect(groupAgents([a, b], 'workspace')).toHaveLength(2)
  })

  it('builds keys from ids, never from labels', () => {
    const [repo] = groupAgents([agent(ws('ws_a'))], 'workspace')
    expect(repo.key).toBe('repository:repo_ad')
    expect(repo.children![0].key).toBe('workspace:ws_a')
    expect(repo.key).not.toContain('Agent-Dashboard')
  })

  it('labels a repository with no name neutrally, still keyed by its id', () => {
    const [repo] = groupAgents([agent(ws('ws_sub', { repository: { id: 'repo_sub', name: '' } }))], 'workspace')
    expect(repo.label).toBe('Repository')
    expect(repo.key).toBe('repository:repo_sub')
  })

  it('leads a repository with its main checkout even when a worktree was seen first', () => {
    const wt = agent(ws('ws_wt', { kind: 'git-worktree', branch: 'feat/x' }))
    const main = agent(ws('ws_main'))
    const [repo] = groupAgents([wt, main], 'workspace')
    expect(repo.children!.map(c => c.workspace!.kind)).toEqual(['git-main', 'git-worktree'])
  })

  it('accounts for every agent exactly once', () => {
    const list = [
      agent(ws('ws_main')),
      agent(ws('ws_wt', { kind: 'git-worktree', branch: 'feat/x' })),
      agent(ws('ws_other', { repository: { id: 'repo_o', name: 'Other' } })),
      agent(ws('ws_plain', { kind: 'plain', branch: '', name: 'n', repository: null })),
      agent(null),
    ]
    const groups = groupAgents(list, 'workspace')
    const seen = leaves(groups).map(a => a.pid).sort((x, y) => x - y)
    expect(seen).toEqual(list.map(a => a.pid).sort((x, y) => x - y))
    for (const g of groups) {
      if (g.children)
        expect(g.agents.length).toBe(g.children.reduce((n, c) => n + c.agents.length, 0))
    }
  })

  it('leaves every other grouping mode single-level, exactly as before', () => {
    const list = [agent(ws('ws_a')), agent(ws('ws_b'))]
    for (const mode of ['none', 'project', 'status', 'model', 'spawner'] as const) {
      for (const g of groupAgents(list, mode)) {
        expect(g.children).toBeUndefined()
        expect(g.kind).toBeUndefined()
      }
    }
  })
})

describe('workspaceDisplay', () => {
  it('names a main checkout by its branch', () => {
    expect(workspaceDisplay(ws('w', { branch: 'feat/localscope-integration' })))
      .toEqual({ title: 'feat/localscope-integration', kind: 'main checkout' })
  })

  it('names a worktree as such', () => {
    expect(workspaceDisplay(ws('w', { kind: 'git-worktree', branch: 'feat/ui' })).kind).toBe('worktree')
  })

  it('says Detached HEAD rather than showing a missing branch', () => {
    expect(workspaceDisplay(ws('w', { kind: 'git-worktree', branch: '', detached: true })).title).toBe('Detached HEAD')
  })

  it('says the branch is unknown when git reported none and it is not detached', () => {
    expect(workspaceDisplay(ws('w', { branch: '' })).title).toBe('Branch unknown')
  })

  it('names a plain workspace by its safe display name, not as a repository', () => {
    expect(workspaceDisplay(ws('w', { kind: 'plain', branch: '', name: 'notes', repository: null })))
      .toEqual({ title: 'notes', kind: 'not a Git repository' })
  })
})

describe('groupPrefix / groupDetail', () => {
  it('introduces a repository with the word Repository', () => {
    const [repo] = groupAgents([agent(ws('ws_a'))], 'workspace')
    expect(groupPrefix(repo)).toBe('Repository')
  })

  it('omits the workspace count for a single-workspace repository', () => {
    const [repo] = groupAgents([agent(ws('ws_a'))], 'workspace')
    expect(groupDetail(repo)).toBeUndefined()
  })

  it('states the count once a repository has two workspaces', () => {
    const [repo] = groupAgents([agent(ws('ws_a')), agent(ws('ws_b', { kind: 'git-worktree', branch: 'x' }))], 'workspace')
    expect(groupDetail(repo)).toBe('2 workspaces')
  })

  it('gives the unknown group no prefix and no workspace count', () => {
    const [unknown] = groupAgents([agent(null)], 'workspace')
    expect(groupPrefix(unknown)).toBeUndefined()
    expect(groupDetail(unknown)).toBeUndefined()
  })
})

describe('agentGroupOptions / resolveGroup — repository & workspace', () => {
  it('offers the mode with and without a spawner filter', () => {
    expect(agentGroupOptions('all').map(o => o.value)).toContain('workspace')
    expect(agentGroupOptions('s1').map(o => o.value)).toContain('workspace')
  })

  it('keeps the mode when a spawner filter is applied', () => {
    expect(resolveGroup('workspace', 's1')).toBe('workspace')
  })
})
