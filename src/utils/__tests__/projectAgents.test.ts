import type { Agent, Project } from '../../types'
import { describe, expect, it } from 'vitest'
import { agentsForProject, canAssociate, isPathUnder, summarizeProjectAgents } from '../projectAgents'

function project(paths: string[], over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    slug: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    folders: paths.map((path, i) => ({ id: `f${i}`, projectId: 'p1', path, isDefault: i === 0, createdAt: '' })),
    ...over,
  } as Project
}

function agent(cwd: string, over: Partial<Agent> = {}): Agent {
  return { cwd, sessionId: cwd, status: 'idle', working: false, ...over } as Agent
}

describe('isPathUnder', () => {
  it('matches the folder itself and its descendants', () => {
    expect(isPathUnder('/home/u/web', '/home/u/web')).toBe(true)
    expect(isPathUnder('/home/u/web/src', '/home/u/web')).toBe(true)
  })

  // The bug a plain startsWith would introduce.
  it('does not match a sibling that merely shares a prefix', () => {
    expect(isPathUnder('/home/u/webapp', '/home/u/web')).toBe(false)
    expect(isPathUnder('/home/u/web-2', '/home/u/web')).toBe(false)
  })

  it('ignores a trailing separator on either side', () => {
    expect(isPathUnder('/home/u/web/', '/home/u/web')).toBe(true)
    expect(isPathUnder('/home/u/web/src', '/home/u/web/')).toBe(true)
  })

  it('is false for empty input rather than matching everything', () => {
    expect(isPathUnder('', '/home/u')).toBe(false)
    expect(isPathUnder('/home/u', '')).toBe(false)
  })

  it('does not match an unrelated path', () => {
    expect(isPathUnder('/var/tmp', '/home/u/web')).toBe(false)
  })
})

describe('agentsForProject', () => {
  it('associates by path containment, across multiple folders', () => {
    const p = project(['/gh/alpha', '/gh/beta'])
    const agents = [agent('/gh/alpha'), agent('/gh/beta/sub'), agent('/gh/gamma')]
    expect(agentsForProject(agents, p).map(a => a.cwd)).toEqual(['/gh/alpha', '/gh/beta/sub'])
  })

  // The whole reason this util exists: projectName is only basename(cwd), so
  // two unrelated checkouts share it. Matching must not be fooled by that.
  it('does not associate a same-named directory in a different location', () => {
    const p = project(['/gh/web'])
    const other = agent('/elsewhere/web', { projectName: 'web' } as Partial<Agent>)
    expect(agentsForProject([other], p)).toEqual([])
  })

  it('returns nothing when the project has no folders', () => {
    expect(agentsForProject([agent('/gh/alpha')], project([]))).toEqual([])
  })
})

describe('summarizeProjectAgents', () => {
  it('reports null — not 0 — when the association cannot be computed', () => {
    const s = summarizeProjectAgents([agent('/gh/alpha')], project([]))
    expect(s.total).toBeNull()
    expect(s.active).toBeNull()
    expect(canAssociate(project([]))).toBe(false)
  })

  it('reports a genuine 0 when folders exist but no agent is inside them', () => {
    const s = summarizeProjectAgents([agent('/gh/other')], project(['/gh/alpha']))
    expect(s.total).toBe(0)
    expect(s.active).toBe(0)
  })

  it('counts working or active agents as active', () => {
    const p = project(['/gh/alpha'])
    const agents = [
      agent('/gh/alpha/one', { status: 'active' }),
      agent('/gh/alpha/two', { status: 'waiting', working: true }),
      agent('/gh/alpha/three', { status: 'idle' }),
    ]
    expect(summarizeProjectAgents(agents, p)).toEqual({ total: 3, active: 2 })
  })
})
