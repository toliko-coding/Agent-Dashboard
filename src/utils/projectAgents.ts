import type { Agent, Project } from '../types'

/*
 * Associating a running agent with a registered Project.
 *
 * There is NO server-side link between the two. `Agent.projectName` is only
 * `filepath.Base(cwd)` computed by the merger — two unrelated checkouts named
 * "web" produce the same string — so matching on that name would be a guess.
 *
 * What IS reliable is path containment: a Project owns absolute folder paths,
 * and an agent reports its absolute `cwd`. An agent whose cwd sits inside a
 * project folder is genuinely working in that project. This is the same test
 * the server's own spawn policy applies when it decides whether a cwd is
 * allowed (isUnder in services/spawn_policy.go).
 *
 * Known limit: the server canonicalises with EvalSymlinks before comparing and
 * the browser cannot resolve symlinks, so an agent reached through a symlinked
 * path will not match. That under-counts (an agent is left unassociated); it
 * never mis-attributes one to the wrong project, which is the failure that
 * would matter.
 */

/** Strips a trailing separator so "/a/b/" and "/a/b" compare equal. */
function normalize(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length > 1 && trimmed.endsWith('/'))
    return trimmed.slice(0, -1)
  return trimmed
}

/**
 * True when `child` is `parent` itself or sits beneath it.
 *
 * Compares on segment boundaries, so "/home/user/webapp" is NOT under
 * "/home/user/web" — a plain startsWith would wrongly say it is.
 */
export function isPathUnder(child: string, parent: string): boolean {
  if (!child || !parent)
    return false
  const c = normalize(child)
  const p = normalize(parent)
  if (c === p)
    return true
  return c.startsWith(`${p}/`)
}

/** Absolute folder paths a project owns. */
export function projectPaths(project: Project): string[] {
  return (project.folders ?? []).map(f => f.path).filter(Boolean)
}

/** Agents whose cwd sits inside one of the project's folders. */
export function agentsForProject(agents: Agent[], project: Project): Agent[] {
  const paths = projectPaths(project)
  if (paths.length === 0)
    return []
  return agents.filter(a => paths.some(p => isPathUnder(a.cwd, p)))
}

/**
 * Whether an association can be computed at all. A project with no registered
 * folder cannot be matched, and its agent count must read as unknown rather
 * than as 0 — 0 would claim we looked and found none.
 */
export function canAssociate(project: Project): boolean {
  return projectPaths(project).length > 0
}

export interface ProjectAgentSummary {
  /** null when the project has no folders, i.e. the count is unknowable. */
  total: number | null
  active: number | null
}

/** Counts for a project row: total associated agents, and those working now. */
export function summarizeProjectAgents(agents: Agent[], project: Project): ProjectAgentSummary {
  if (!canAssociate(project))
    return { total: null, active: null }
  const mine = agentsForProject(agents, project)
  return {
    total: mine.length,
    // Mirrors the roster's "running" bucket: an open turn, or active status.
    active: mine.filter(a => a.working === true || a.status === 'active').length,
  }
}
