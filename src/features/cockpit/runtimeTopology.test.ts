import type { MachineProcess, MachineService } from '@/features/localscope'
import type { Agent, WorkspaceRef } from '@/types'
import { describe, expect, it } from 'vitest'
import { buildRuntimeTopology } from './runtimeTopology'

/*
 * The runtime topology model. The property under test throughout: every edge
 * is identity equality — never cwd, projectName, branch or a display name.
 */

let nextId = 0

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

function agent(workspace: WorkspaceRef | null, over: Partial<Agent> = {}): Agent {
  nextId++
  return {
    pid: nextId,
    sessionId: `s${nextId}`,
    projectName: 'Agent-Dashboard',
    cwd: '/Users/x/Agent-Dashboard',
    status: 'active',
    working: false,
    model: 'claude-opus-5',
    workspace,
    ...over,
  } as unknown as Agent
}

function service(workspace: WorkspaceRef | null, port: number, over: Record<string, unknown> = {}): MachineService {
  return { id: `svc-${port}`, port, cwd: '/Users/x/Agent-Dashboard', label: 'Server', workspace, ...over } as unknown as MachineService
}

function proc(workspace: WorkspaceRef | null, name: string, over: Record<string, unknown> = {}): MachineProcess {
  nextId++
  return { id: `p${nextId}`, pid: nextId, name, cwd: '/Users/x/Agent-Dashboard', workspace, ...over } as unknown as MachineProcess
}

const main = () => ws('ws_main', { branch: 'feat/localscope-integration' })
const worktree = () => ws('ws_wt', { kind: 'git-worktree', branch: 'tmp/2dg-verify', name: 'wt-2dg' })

describe('buildRuntimeTopology — repositories and workspaces', () => {
  it('puts two workspaces of one repository under ONE repository node', () => {
    const t = buildRuntimeTopology({
      agents: [agent(main())],
      services: [service(worktree(), 5195)],
      processes: [],
    })
    expect(t.repositories).toHaveLength(1)
    expect(t.repositories[0].key).toBe('repository:repo_ad')
    expect(t.repositories[0].workspaces.map(w => w.key)).toEqual(['workspace:ws_main', 'workspace:ws_wt'])
  })

  it('keeps two repositories that share a display name as two nodes', () => {
    const t = buildRuntimeTopology({
      agents: [
        agent(ws('ws_a', { repository: { id: 'repo_1', name: 'web' } })),
        agent(ws('ws_b', { repository: { id: 'repo_2', name: 'web' } })),
      ],
      services: [],
      processes: [],
    })
    expect(t.repositories.map(r => r.id)).toEqual(['repo_1', 'repo_2'])
    expect(t.repositories.map(r => r.label)).toEqual(['web', 'web'])
  })

  it('does not split one repository whose display name differs between observations', () => {
    const t = buildRuntimeTopology({
      agents: [agent(ws('ws_a', { repository: { id: 'repo_1', name: 'first' } }))],
      services: [service(ws('ws_b', { repository: { id: 'repo_1', name: 'second' } }), 3000)],
      processes: [],
    })
    expect(t.repositories).toHaveLength(1)
  })

  it('attaches an agent, a service and a process in one workspace to the same node', () => {
    const t = buildRuntimeTopology({
      agents: [agent(main())],
      services: [service(main(), 5173), service(main(), 13120)],
      processes: [proc(main(), 'node'), proc(main(), 'pnpm')],
    })
    const [node] = t.repositories[0].workspaces
    expect(node.agents).toHaveLength(1)
    expect(node.services.map(s => s.port)).toEqual([5173, 13120])
    expect(node.processes.map(p => p.name)).toEqual(['node', 'pnpm'])
  })

  it('never cross-attributes between workspaces of the same repository', () => {
    const t = buildRuntimeTopology({
      agents: [agent(main())],
      services: [service(main(), 5173), service(worktree(), 5195)],
      processes: [proc(main(), 'node'), proc(worktree(), 'Python')],
    })
    const [mainNode, wtNode] = t.repositories[0].workspaces
    expect(mainNode.services.map(s => s.port)).toEqual([5173])
    expect(mainNode.processes.map(p => p.name)).toEqual(['node'])
    expect(wtNode.services.map(s => s.port)).toEqual([5195])
    expect(wtNode.processes.map(p => p.name)).toEqual(['Python'])
    expect(wtNode.agents).toEqual([])
  })

  it('creates a workspace node from an observation even with no agent in it', () => {
    const t = buildRuntimeTopology({ agents: [], services: [], processes: [proc(worktree(), 'Python')] })
    expect(t.repositories[0].workspaces.map(w => w.workspace.kind)).toEqual(['git-worktree'])
  })

  it('leads a repository with its main checkout even when a worktree was seen first', () => {
    const t = buildRuntimeTopology({ agents: [agent(worktree()), agent(main())], services: [], processes: [] })
    expect(t.repositories[0].workspaces.map(w => w.workspace.kind)).toEqual(['git-main', 'git-worktree'])
  })

  it('labels a repository with no name neutrally, keyed by its id', () => {
    const t = buildRuntimeTopology({
      agents: [agent(ws('ws_s', { repository: { id: 'repo_sub', name: '' } }))],
      services: [],
      processes: [],
    })
    expect(t.repositories[0].label).toBe('Repository')
    expect(t.repositories[0].key).toBe('repository:repo_sub')
  })
})

describe('buildRuntimeTopology — plain and unresolved', () => {
  it('collects a plain workspace as local, with no synthesised repository', () => {
    const plain = ws('ws_plain', { kind: 'plain', branch: '', name: 'plain-2dg', repository: null })
    const t = buildRuntimeTopology({ agents: [], services: [service(plain, 5194)], processes: [proc(plain, 'Python')] })
    expect(t.repositories).toEqual([])
    expect(t.local.map(w => w.key)).toEqual(['workspace:ws_plain'])
    expect(t.local[0].services).toHaveLength(1)
    expect(t.local[0].processes).toHaveLength(1)
  })

  it('keeps observations with no workspace unresolved, with exact counts', () => {
    const lost = agent(null)
    const t = buildRuntimeTopology({
      agents: [lost, agent(main())],
      services: [service(null, 9999), service(main(), 5173)],
      processes: [proc(null, 'adb'), proc(null, 'qemu'), proc(main(), 'node')],
    })
    expect(t.unresolved.agents).toEqual([lost])
    expect(t.unresolved.services).toBe(1)
    expect(t.unresolved.processes).toBe(2)
    // Unresolved observations never inflate a workspace.
    const [node] = t.repositories[0].workspaces
    expect(node.services).toHaveLength(1)
    expect(node.processes).toHaveLength(1)
  })

  it('reports an unobserved list as unknown, never as zero', () => {
    const t = buildRuntimeTopology({ agents: [agent(main())], services: null, processes: null })
    expect(t.unresolved.services).toBeNull()
    expect(t.unresolved.processes).toBeNull()
    expect(t.repositories[0].workspaces[0].services).toEqual([])
  })

  it('treats a malformed list as unobserved', () => {
    const t = buildRuntimeTopology({ agents: [], services: 'nope' as any, processes: { a: 1 } as any })
    expect(t.unresolved.services).toBeNull()
    expect(t.unresolved.processes).toBeNull()
  })
})

/* Grouping must never use a name, a path or a branch. */
describe('buildRuntimeTopology — no non-identity grouping', () => {
  it('does not group by projectName', () => {
    const t = buildRuntimeTopology({
      agents: [
        agent(ws('ws_a'), { projectName: 'same' }),
        agent(ws('ws_b', { repository: { id: 'repo_b', name: 'Other' } }), { projectName: 'same' }),
      ],
      services: [],
      processes: [],
    })
    expect(t.repositories).toHaveLength(2)
  })

  it('does not attach an unresolved agent to a repository whose name matches', () => {
    const t = buildRuntimeTopology({
      agents: [agent(main(), { projectName: 'Agent-Dashboard' }), agent(null, { projectName: 'Agent-Dashboard' })],
      services: [],
      processes: [],
    })
    expect(t.repositories[0].workspaces[0].agents).toHaveLength(1)
    expect(t.unresolved.agents).toHaveLength(1)
  })

  it('does not group by cwd — an identical cwd in another workspace stays apart', () => {
    const t = buildRuntimeTopology({
      agents: [agent(main(), { cwd: '/Users/x/Repo' })],
      services: [service(worktree(), 5195, { cwd: '/Users/x/Repo' })],
      processes: [],
    })
    expect(t.repositories[0].workspaces[0].services).toEqual([])
    expect(t.repositories[0].workspaces[1].services).toHaveLength(1)
  })

  it('does not group by branch — equal branches stay separate workspaces', () => {
    const t = buildRuntimeTopology({
      agents: [agent(ws('ws_a', { branch: 'main' })), agent(ws('ws_b', { kind: 'git-worktree', branch: 'main' }))],
      services: [],
      processes: [],
    })
    expect(t.repositories[0].workspaces).toHaveLength(2)
  })

  it('does not group by workspace display name', () => {
    const t = buildRuntimeTopology({
      agents: [agent(ws('ws_a', { name: 'same' })), agent(ws('ws_b', { kind: 'git-worktree', name: 'same' }))],
      services: [],
      processes: [],
    })
    expect(t.repositories[0].workspaces).toHaveLength(2)
  })

  it('lets the agent label a workspace both it and LocalScope observed', () => {
    const t = buildRuntimeTopology({
      agents: [agent(ws('ws_a', { branch: 'from-agent' }))],
      services: [service(ws('ws_a', { branch: 'from-service' }), 3000)],
      processes: [],
    })
    expect(t.repositories[0].workspaces[0].workspace.branch).toBe('from-agent')
  })
})
