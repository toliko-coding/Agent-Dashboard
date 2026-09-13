import type { AttentionItem } from '@/features/attention'
import type { Agent, WorkspaceRef } from '@/types'
import { describe, expect, it } from 'vitest'
import { activeWorkAgents, agentFootprint, liveAgents, workActivity } from './commandModel'

function ws(id: string, repoId: string | null, o: Partial<WorkspaceRef> = {}): WorkspaceRef {
  return {
    id,
    name: 'web',
    kind: repoId ? 'git-main' : 'plain',
    branch: 'main',
    repository: repoId ? { id: repoId, name: 'web' } : null,
    ...o,
  }
}

function agent(o: Partial<Agent>): Agent {
  return { sessionId: 's', pid: 1, status: 'active', working: false, workspace: null, subagents: [], ...o } as Agent
}

function attentionFor(sessionId: string): AttentionItem {
  return { id: `agent:${sessionId}`, level: 'blocking', kind: 'question', subject: { type: 'agent', sessionId }, agentSessionId: sessionId, workspace: null, repository: null, title: '', reason: '', since: null, lastActivity: null }
}

describe('active work', () => {
  it('includes a working agent', () => {
    expect(activeWorkAgents([agent({ sessionId: 'w', working: true })], []).map(a => a.sessionId)).toEqual(['w'])
  })

  it('excludes idle, resting and finished agents', () => {
    const agents = [
      agent({ sessionId: 'idle', status: 'idle' }),
      agent({ sessionId: 'resting', status: 'active', working: false }),
      agent({ sessionId: 'finished', status: 'finished', working: true }),
    ]
    expect(activeWorkAgents(agents, [])).toEqual([])
  })

  it('excludes Claude Code\'s own internal processes', () => {
    expect(activeWorkAgents([agent({ working: true, internalProcess: true })], [])).toEqual([])
  })

  it('excludes a working agent that is waiting on the user, which Needs you already shows', () => {
    expect(activeWorkAgents([agent({ sessionId: 'blocked', working: true })], [attentionFor('blocked')])).toEqual([])
  })

  it('counts only live sessions for the runtime', () => {
    expect(liveAgents([agent({ status: 'finished' }), agent({ internalProcess: true }), agent({ sessionId: 'x' })]).map(a => a.sessionId)).toEqual(['x'])
  })
})

describe('agent footprint', () => {
  it('counts repositories and workspaces by identity, so same-name repositories stay two', () => {
    const footprint = agentFootprint([
      agent({ workspace: ws('ws-1', 'repo-a') }),
      agent({ workspace: ws('ws-2', 'repo-b') }),
      agent({ workspace: ws('ws-3', 'repo-a', { kind: 'git-worktree', branch: 'feat' }) }),
      agent({ workspace: ws('ws-1', 'repo-a') }),
      agent({ workspace: ws('ws-plain', null) }),
      agent({ workspace: null }),
    ])
    expect(footprint).toEqual({ repositories: 2, workspaces: 4, unresolved: 1 })
  })
})

describe('work activity', () => {
  it('names an open tool call by tool name only', () => {
    const activity = workActivity(agent({ working: true, pendingToolUse: { id: 't', tool: 'Bash', pattern: 'rm -rf /tmp/x', patternDisplay: 'rm -rf /tmp/x' } }))
    expect(activity).toEqual({ state: 'tool', label: 'Using Bash' })
  })

  it('is plainly working otherwise', () => {
    expect(workActivity(agent({ working: true }))).toEqual({ state: 'working', label: 'Working' })
  })
})
