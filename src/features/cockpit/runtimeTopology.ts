import type { MachineProcess, MachineService } from '@/features/localscope'
import type { Agent, WorkspaceRef } from '@/types'

/*
 * The read-only runtime identity graph, built before anything is drawn:
 *
 *   Repository
 *     └── Workspace
 *           ├── Agents
 *           ├── Processes
 *           └── Services
 *
 * Every edge in it is identity equality and nothing else. An agent, a service
 * and a process belong to a workspace exactly when their WorkspaceRef ids are
 * equal — the rule the agent cards and the agent panel already use — and a
 * workspace belongs to a repository exactly when its RepositoryRef id matches.
 * No cwd, projectName, basename, branch, service name or process name ever
 * decides where something goes. Names are carried only so a node can be read.
 *
 * A workspace node exists as soon as ANY observation names it, not only when an
 * agent does. That is the point of drawing machine state: a worktree running a
 * dev server with no Claude session in it is still a real, separate workspace,
 * and must not vanish or fold into the main checkout.
 *
 * Plain (non-git) workspaces carry no repository, so they are collected as
 * local workspaces instead of being handed a synthesised repository node.
 * Observations with no workspace identity are kept apart as unresolved —
 * agents listed, services and processes counted — and never attached to the
 * nearest plausible workspace.
 */

export interface TopologyWorkspace {
  /** `workspace:<WorkspaceRef.id>` — identity, never a name. */
  key: string
  workspace: WorkspaceRef
  agents: Agent[]
  processes: MachineProcess[]
  services: MachineService[]
}

export interface TopologyRepository {
  /** `repository:<RepositoryRef.id>` — identity, never a name. */
  key: string
  id: string
  /** Display only. Two repositories may share it and still be two nodes. */
  label: string
  workspaces: TopologyWorkspace[]
}

export interface RuntimeTopology {
  repositories: TopologyRepository[]
  /** Plain workspaces: real workspaces with no repository. */
  local: TopologyWorkspace[]
  unresolved: {
    agents: Agent[]
    /**
     * Observations that carry no workspace identity. `null` when the list
     * itself was not observed — "we could not see" is never reported as zero.
     */
    processes: number | null
    services: number | null
  }
}

// Within a repository the main checkout leads and its worktrees follow.
const WORKSPACE_KIND_ORDER: Record<string, number> = { 'git-main': 0, 'git-worktree': 1, 'plain': 2 }

export function buildRuntimeTopology(input: {
  agents: Agent[]
  /** `null` when the list was not observed. */
  services: MachineService[] | null
  processes: MachineProcess[] | null
}): RuntimeTopology {
  const repositories = new Map<string, TopologyRepository>()
  const workspaces = new Map<string, TopologyWorkspace>()
  const local: TopologyWorkspace[] = []

  /*
   * The first observation to name a workspace supplies its display fields.
   * Agents are read first, so where an agent and LocalScope both see a
   * workspace, the agent's view of its branch labels it. Identity is the same
   * either way — every ref comes from the one server-side resolver.
   */
  function nodeFor(ref: WorkspaceRef): TopologyWorkspace {
    const key = `workspace:${ref.id}`
    const existing = workspaces.get(key)
    if (existing)
      return existing

    const node: TopologyWorkspace = { key, workspace: ref, agents: [], processes: [], services: [] }
    workspaces.set(key, node)

    if (ref.repository?.id) {
      const repoKey = `repository:${ref.repository.id}`
      let repo = repositories.get(repoKey)
      if (!repo) {
        // A bare repository or submodule has no working-tree name to show.
        repo = { key: repoKey, id: ref.repository.id, label: ref.repository.name || 'Repository', workspaces: [] }
        repositories.set(repoKey, repo)
      }
      repo.workspaces.push(node)
    }
    else {
      local.push(node)
    }
    return node
  }

  const unresolvedAgents: Agent[] = []
  for (const agent of input.agents) {
    if (agent.workspace?.id)
      nodeFor(agent.workspace).agents.push(agent)
    else
      unresolvedAgents.push(agent)
  }

  function attach<T extends { workspace: WorkspaceRef | null }>(
    items: T[] | null,
    push: (node: TopologyWorkspace, item: T) => void,
  ): number | null {
    // Anything that is not a list — including a malformed body — is "not
    // observed", which must not read as zero unattributed observations.
    if (!Array.isArray(items))
      return null
    let unattributed = 0
    for (const item of items) {
      if (item.workspace?.id)
        push(nodeFor(item.workspace), item)
      else
        unattributed++
    }
    return unattributed
  }

  const unresolvedServices = attach(input.services, (node, s) => node.services.push(s))
  const unresolvedProcesses = attach(input.processes, (node, p) => node.processes.push(p))

  for (const repo of repositories.values()) {
    repo.workspaces.sort((a, b) =>
      (WORKSPACE_KIND_ORDER[a.workspace.kind] ?? 3) - (WORKSPACE_KIND_ORDER[b.workspace.kind] ?? 3))
  }

  return {
    repositories: [...repositories.values()],
    local,
    unresolved: { agents: unresolvedAgents, processes: unresolvedProcesses, services: unresolvedServices },
  }
}
