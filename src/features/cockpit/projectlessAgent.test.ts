import type { Agent, WorkspaceRef } from '@/types'
import { describe, expect, it } from 'vitest'
import { buildRuntimeTopology } from './runtimeTopology'

/*
 * L (3M): an agent started without a Dashboard Project correlates to Runtime
 * by workspace identity alone — a Project is never part of placement.
 */

const PLAIN: WorkspaceRef = { id: 'ws_plain', name: 'plain', kind: 'plain', branch: '', repository: null } as WorkspaceRef
const REPO: WorkspaceRef = { id: 'ws_repo', name: 'local-repo', kind: 'git-main', branch: 'main', repository: { id: 'repo_local', name: 'local-repo' } } as WorkspaceRef

function agent(sessionId: string, workspace: WorkspaceRef | null): Agent {
  return { sessionId, pid: 1, status: 'active', working: false, workspace } as unknown as Agent
}
function service(port: number, workspace: WorkspaceRef | null) {
  return { id: `s${port}`, port, workspace } as never
}

describe('projectless agents in the runtime topology', () => {
  it('places a plain-folder agent with the service in the same workspace, with no repository invented', () => {
    const t = buildRuntimeTopology({ agents: [agent('a', PLAIN)], services: [service(5173, PLAIN)], processes: [] })
    expect(t.repositories).toEqual([])
    expect(t.local).toHaveLength(1)
    expect(t.local[0].agents.map(a => a.sessionId)).toEqual(['a'])
    expect(t.local[0].services.map(s => s.port)).toEqual([5173])
  })

  it('places a local-repository agent (no GitHub) under its repository by identity', () => {
    const t = buildRuntimeTopology({ agents: [agent('b', REPO)], services: [service(3000, REPO)], processes: [] })
    expect(t.repositories.map(r => r.id)).toEqual(['repo_local'])
    expect(t.repositories[0].workspaces[0].services.map(s => s.port)).toEqual([3000])
  })
})
