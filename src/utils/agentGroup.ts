import type { Agent, WorkspaceRef } from '../types'
import { AGENT_STATUSES, SPAWNER_SOURCE_ENV } from '../types'
import { STATUS_ORDER } from './agentSort'
import { secondsSince, shortModel } from './format'
import { friendlyProjectName } from './friendlyProjectName'
import { agentDisplayStatus } from './statusColors'

export const AGENT_SORT_OPTIONS = [
  { value: 'latest', label: 'Latest active' },
  { value: 'longest', label: 'Longest running' },
  { value: 'expensive', label: 'Most expensive' },
] as const

// The control that renders these is already labelled "Group", so the options
// name the dimension alone instead of repeating "Group by …" in every row.
export const AGENT_GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  // The value stays `project` so saved selections keep working. The label says
  // what this actually groups by: the agent's folder name (projectName, which is
  // basename(cwd)). It is NOT the persisted Dashboard Project, and it is not a
  // repository or a workspace — those have their own mode and their own words.
  { value: 'project', label: 'Folder' },
  { value: 'status', label: 'Status' },
  { value: 'model', label: 'Model' },
  { value: 'spawner', label: 'Spawner' },
  // Two levels — repository, then workspace — keyed on opaque identity ids.
  // See groupByWorkspace for why neither level alone is enough.
  { value: 'workspace', label: 'Repository & workspace' },
] as const

export type AgentSort = typeof AGENT_SORT_OPTIONS[number]['value']
export type AgentGroup = typeof AGENT_GROUP_OPTIONS[number]['value']

const UNASSIGNED_SPAWNER_KEY = '__unassigned__'

/** Grouping by spawner is redundant while a single spawner is filtered, so the option drops out. */
export function agentGroupOptions(spawnerFilter: string): ReadonlyArray<{ value: AgentGroup, label: string }> {
  return spawnerFilter === 'all'
    ? AGENT_GROUP_OPTIONS
    : AGENT_GROUP_OPTIONS.filter(o => o.value !== 'spawner')
}

/** Falls back to 'none' when the stored grouping is unavailable under the current filter. */
export function resolveGroup(groupBy: AgentGroup, spawnerFilter: string): AgentGroup {
  return agentGroupOptions(spawnerFilter).some(o => o.value === groupBy) ? groupBy : 'none'
}

/**
 * What a group structurally is. Set only by the repository-and-workspace mode;
 * every other mode leaves it undefined and renders exactly as before.
 */
export type AgentGroupKind = 'repository' | 'local' | 'unknown' | 'workspace'

export interface AgentGrouping {
  key: string
  label: string | null
  agents: Agent[]
  /** Set when the grouping was derived rather than recorded; carries the why. */
  derivedFrom?: string
  kind?: AgentGroupKind
  /**
   * The second level. Present on repository and local sections only. Every
   * agent in `agents` appears in exactly one child, so the parent's count and
   * cost stay the sum of what it contains.
   */
  children?: AgentGrouping[]
  /** The workspace a second-level group stands for, for its row to describe. */
  workspace?: WorkspaceRef
}

const LOCAL_WORKSPACES_KEY = 'workspace-section:local'
const UNKNOWN_WORKSPACE_KEY = 'workspace-section:unknown'

/**
 * The words for a workspace: a title and what kind of checkout it is.
 *
 * Shared by the roster row and anything else that names a workspace, so a
 * detached worktree reads "Detached HEAD" everywhere rather than as a branch
 * that happens to be missing.
 */
export function workspaceDisplay(ws: WorkspaceRef): { title: string, kind: string } {
  if (ws.kind === 'plain')
    return { title: ws.name, kind: 'not a Git repository' }
  const title = ws.detached ? 'Detached HEAD' : (ws.branch || 'Branch unknown')
  return { title, kind: ws.kind === 'git-worktree' ? 'worktree' : 'main checkout' }
}

/** The structural word a first-level group is introduced with, if any. */
export function groupPrefix(group: AgentGrouping): string | undefined {
  return group.kind === 'repository' ? 'Repository' : undefined
}

/**
 * A workspace count, only where it says something.
 *
 * Omitted for a single workspace: nearly every repository has exactly one
 * active checkout, and "1 workspace" on each of them is noise. Two or more is
 * the fact worth stating — it is how a worktree announces itself.
 */
export function groupDetail(group: AgentGrouping): string | undefined {
  const n = group.children?.length ?? 0
  return n >= 2 ? `${n} workspaces` : undefined
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  waiting: 'Waiting on you',
  idle: 'Idle',
}

export function sortAgents(list: Agent[], sortBy: AgentSort, nowMs: number): Agent[] {
  const sorted = [...list]
  if (sortBy === 'longest') {
    sorted.sort((a, b) => b.uptime - a.uptime)
  }
  else if (sortBy === 'expensive') {
    sorted.sort((a, b) => b.costEstimate - a.costEstimate)
  }
  else {
    // latest: ascending seconds-since-activity = most-recently-active first
    sorted.sort((a, b) => {
      const sa = secondsSince(a.lastActivity, nowMs) ?? Infinity
      const sb = secondsSince(b.lastActivity, nowMs) ?? Infinity
      return sa - sb
    })
  }
  return sorted
}

function bucketBy(list: Agent[], keyOf: (agent: Agent) => { key: string, label: string }): AgentGrouping[] {
  const seen = new Map<string, AgentGrouping>()
  for (const agent of list) {
    const { key, label } = keyOf(agent)
    const bucket = seen.get(key)
    if (bucket) {
      bucket.agents.push(agent)
    }
    else {
      seen.set(key, { key, label, agents: [agent] })
    }
  }
  return Array.from(seen.values())
}

export function groupAgents(list: Agent[], groupBy: AgentGroup): AgentGrouping[] {
  if (groupBy === 'project') {
    return bucketBy(list, agent => ({
      key: agent.projectName,
      label: friendlyProjectName(agent.projectName),
    }))
  }

  if (groupBy === 'status') {
    return AGENT_STATUSES
      .slice()
      .sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b])
      .map(s => ({
        key: s,
        label: STATUS_LABELS[s] ?? s,
        // A working agent is live regardless of its idle/waiting time bucket -
        // folds into 'active' so the band can't disagree with the Working badge.
        agents: list.filter(a => (agentDisplayStatus(a) === 'working' ? 'active' : a.status) === s),
      }))
      .filter(g => g.agents.length > 0)
  }

  if (groupBy === 'model') {
    return bucketBy(list, (agent) => {
      const key = shortModel(agent.model ?? null)
      return { key, label: key }
    })
  }

  if (groupBy === 'spawner') {
    // The server attributes each agent to a configured spawner (from its
    // pipeline task, or from the config dir its process runs on); anything it
    // could not place lands in one trailing bucket.
    const groups = bucketBy(list, agent => (
      agent.spawnerId
        ? { key: agent.spawnerId, label: agent.spawnerName || agent.spawnerId }
        : { key: UNASSIGNED_SPAWNER_KEY, label: 'Unassigned' }
    ))
    for (const group of groups) {
      if (group.agents.some(a => a.spawnerSource === SPAWNER_SOURCE_ENV))
        group.derivedFrom = 'Derived from the config directory these sessions run on'
    }
    // Unattributed agents are the residual bucket, so they trail the named ones.
    return groups.sort((a, b) =>
      Number(a.key === UNASSIGNED_SPAWNER_KEY) - Number(b.key === UNASSIGNED_SPAWNER_KEY))
  }

  if (groupBy === 'workspace')
    return groupByWorkspace(list)

  return [{ key: 'all', label: null, agents: list }]
}

// Main checkout before its worktrees, so the primary branch leads its repository.
const WORKSPACE_KIND_ORDER: Record<string, number> = { 'git-main': 0, 'git-worktree': 1, 'plain': 2 }

/*
 * Repository -> workspace, read straight off each agent's WorkspaceRef.
 *
 * Grouping keys are opaque ids and nothing else: the repository id for the
 * first level, the workspace id for the second. Names are display only — two
 * clones both called "web" are two repositories that share a label, and a
 * rename changes a heading, never a group. (The `project` mode keys on
 * projectName, which is basename(cwd); it is left exactly as it was.)
 *
 * Why two levels rather than one: repository identity is what makes a worktree
 * recognisably the same project, and workspace identity is what keeps it a
 * separate one, with its own branch, agents and services. One level on the
 * repository id would merge two worktrees; one level on the workspace id would
 * scatter a repository into unrelated-looking groups.
 *
 * Plain (non-git) workspaces have no repository, so they sit under a "Local
 * workspaces" section rather than inside a synthesised one. Agents with no
 * workspace identity trail in "Workspace unknown": present, never dropped, and
 * never attached to a repository whose name happens to match.
 */
function groupByWorkspace(list: Agent[]): AgentGrouping[] {
  const repositories = new Map<string, AgentGrouping>()
  const local: AgentGrouping = { key: LOCAL_WORKSPACES_KEY, label: 'Local workspaces', kind: 'local', agents: [], children: [] }
  const unknown: AgentGrouping = { key: UNKNOWN_WORKSPACE_KEY, label: 'Workspace unknown', kind: 'unknown', agents: [] }

  for (const agent of list) {
    const ws = agent.workspace
    if (!ws?.id) {
      unknown.agents.push(agent)
      continue
    }

    let parent = local
    if (ws.repository?.id) {
      const key = `repository:${ws.repository.id}`
      let repo = repositories.get(key)
      if (!repo) {
        // A bare repository or a submodule has no working-tree name to show.
        repo = { key, label: ws.repository.name || 'Repository', kind: 'repository', agents: [], children: [] }
        repositories.set(key, repo)
      }
      parent = repo
    }

    parent.agents.push(agent)
    const childKey = `workspace:${ws.id}`
    let child = parent.children!.find(c => c.key === childKey)
    if (!child) {
      child = { key: childKey, label: workspaceDisplay(ws).title, kind: 'workspace', workspace: ws, agents: [] }
      parent.children!.push(child)
    }
    child.agents.push(agent)
  }

  const sections = [...repositories.values()]
  if (local.children!.length > 0)
    sections.push(local)
  for (const section of sections) {
    section.children!.sort((a, b) =>
      (WORKSPACE_KIND_ORDER[a.workspace!.kind] ?? 3) - (WORKSPACE_KIND_ORDER[b.workspace!.kind] ?? 3))
  }
  // The residual bucket trails the identified ones, as Unassigned does for spawners.
  if (unknown.agents.length > 0)
    sections.push(unknown)
  return sections
}
