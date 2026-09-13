import type { AttentionItem } from './queue'
import type { PermissionItem } from '@/composables/usePendingPermissions'
import type { PendingCapabilityDecision } from '@/sdk.generated'
import type { Agent, PendingPermission, PipelineTask, WorkspaceRef } from '@/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentTitle, attentionQueueState, buildAttentionQueue, compareAttention } from './queue'

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const WORKSPACE: WorkspaceRef = {
  id: 'ws-main',
  name: 'Agent-Dashboard',
  kind: 'git-main',
  branch: 'main',
  repository: { id: 'repo-1', name: 'Agent-Dashboard' },
}

function makeAgent(o: Partial<Agent> = {}): Agent {
  return {
    pid: 1,
    sessionId: 'sess-a',
    provider: 'claude',
    projectPath: '/Users/someone/private/project',
    projectName: 'project',
    cwd: '/Users/someone/private/project',
    entrypoint: 'cli',
    status: 'active',
    uptime: 0,
    lastActivity: ago(1),
    currentAction: null,
    lastTools: [],
    tasks: [],
    subagents: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    costEstimate: 0,
    cacheCreationCostEstimate: 0,
    cacheReadCostEstimate: 0,
    healthScore: 100,
    conversationTurns: 0,
    toolCounts: {},
    channelAvailable: false,
    working: false,
    permissionsBypassed: false,
    convergenceAlert: false,
    meta: null,
    workspace: WORKSPACE,
    ...o,
  } as Agent
}

function permission(o: Partial<PendingPermission> = {}): PendingPermission {
  return { id: 'perm-1', tool: 'Bash', pattern: 'rm -rf /tmp/scratch', requestedAt: ago(5), ...o }
}

function permissionItem(taskId: string, requestedAt = ago(9)): PermissionItem {
  return {
    taskId,
    title: `Task ${taskId}`,
    projectName: 'project',
    requests: [{ id: `req-${taskId}`, stageRunId: 'run-1', tool: 'Bash', pattern: 'git push', reason: null, requestedAt, resolvedAt: null, outcome: null }],
  }
}

function task(o: Partial<PipelineTask> & Pick<PipelineTask, 'id'>): PipelineTask {
  return { title: `Task ${o.id}`, currentStage: 'plan_review', needsUser: true, cwd: '/Users/someone/private/project', ...o } as PipelineTask
}

function capability(o: Partial<PendingCapabilityDecision> = {}): PendingCapabilityDecision {
  return { id: 'cap-1', capability: 'mail.send', value: 'someone@example.com', context: 'global', reason: 'send report', requestedAt: ago(3), ...o }
}

function queue(sources: Partial<Parameters<typeof buildAttentionQueue>[0]>): AttentionItem[] {
  return buildAttentionQueue({ agents: [], permissionItems: [], capabilityDecisions: [], tasks: [], ...sources })
}

describe('attention model — blocking', () => {
  // A
  it('reports a held permission call as blocking, with the time it was requested', () => {
    const requestedAt = ago(7)
    const [item] = queue({ agents: [makeAgent({ heldPermissions: [permission({ requestedAt })] })] })
    expect(item).toMatchObject({ level: 'blocking', kind: 'permission', reason: 'Permission request waiting', detail: 'Bash', since: requestedAt })
  })

  it('reports a pipeline stage run\'s stored permission requests as blocking', () => {
    const [item] = queue({ agents: [makeAgent({ pendingPermissions: [permission(), permission({ id: 'perm-2' })] })] })
    expect(item).toMatchObject({ level: 'blocking', kind: 'permission', detail: 'Bash · 2 requests' })
  })

  it('reports the session\'s own permission prompt as blocking, without inventing a time', () => {
    const [item] = queue({ agents: [makeAgent({ awaitingTerminalPermission: true })] })
    expect(item).toMatchObject({ level: 'blocking', kind: 'terminal-permission', since: null })
  })

  // B
  it('reports an AskUserQuestion modal as blocking', () => {
    const [item] = queue({ agents: [makeAgent({ pendingQuestion: { header: '', question: 'Which database password?', multiSelect: false, options: [], typeSomethingIndex: 1, chatAboutIndex: 2 } })] })
    expect(item).toMatchObject({ level: 'blocking', kind: 'question', reason: 'Question waiting for your answer' })
  })

  it('reports the answers submit screen as blocking', () => {
    const [item] = queue({ agents: [makeAgent({ pendingConfirm: { question: 'Ready to submit your answers?', options: [] } })] })
    expect(item).toMatchObject({ level: 'blocking', kind: 'confirm' })
  })

  it('reports a capability decision as blocking, belonging to no agent', () => {
    const [item] = queue({ capabilityDecisions: [capability()] })
    expect(item).toMatchObject({ level: 'blocking', kind: 'capability', agentSessionId: null, detail: 'mail.send' })
  })
})

describe('attention model — failed', () => {
  // C
  it('reports a classified API error on a session that is not working', () => {
    const [item] = queue({ agents: [makeAgent({ errorState: 'rate_limited', working: false })] })
    expect(item).toMatchObject({ level: 'failed', kind: 'api-error', reason: 'Rate limited' })
  })

  it('does not report an error the session has already worked past', () => {
    expect(queue({ agents: [makeAgent({ errorState: 'rate_limited', working: true })] })).toEqual([])
  })

  it('does not report a finished agent\'s reconstructed error', () => {
    expect(queue({ agents: [makeAgent({ errorState: 'auth_failed', status: 'finished' })] })).toEqual([])
  })
})

describe('attention model — not attention', () => {
  // D
  it('does not flag a working agent, even with an unresolved tool call and no recent activity', () => {
    const agent = makeAgent({ working: true, pendingToolUse: { id: 'tu', tool: 'Bash', pattern: 'npm test', patternDisplay: 'npm test' }, lastActivity: ago(30) })
    expect(queue({ agents: [agent] })).toEqual([])
  })

  // E
  it('does not flag an idle agent or one that just finished its turn', () => {
    expect(queue({ agents: [
      makeAgent({ sessionId: 'idle', status: 'idle', working: false, lastActivity: ago(120) }),
      makeAgent({ sessionId: 'recent', status: 'active', working: false, lastActivity: ago(0) }),
      makeAgent({ sessionId: 'quiet', status: 'waiting', working: false }),
    ] })).toEqual([])
  })

  it('has no stalled producer: silence with an unresolved tool call is not inferred as stuck', () => {
    const agent = makeAgent({ status: 'active', working: false, pendingToolUse: { id: 'tu', tool: 'Bash', pattern: '', patternDisplay: '' }, lastActivity: ago(45) })
    expect(queue({ agents: [agent] }).filter(i => i.level === 'stalled')).toEqual([])
  })

  it('does not report a task that is not waiting on the user', () => {
    expect(queue({ tasks: [task({ id: 't1', needsUser: false })] })).toEqual([])
  })
})

describe('attention model — connection state is not attention', () => {
  const blocked = [makeAgent({ heldPermissions: [permission()] })]

  // F
  it('keeps the same items, and adds no failure, when agent updates stop arriving', () => {
    const items = queue({ agents: blocked })
    const live = attentionQueueState({ items, agentsObserved: true, agentsError: null, tasksLoading: false, live: true })
    const down = attentionQueueState({ items, agentsObserved: true, agentsError: null, tasksLoading: false, live: false })
    expect(down.items).toEqual(live.items)
    expect(down.items.some(i => i.level === 'failed')).toBe(false)
    expect(down).toMatchObject({ status: 'ready', stale: true })
  })

  // G
  it('takes nothing from LocalScope, so an unavailable collector cannot create attention', () => {
    const sources = ['queue.ts', 'useAttentionQueue.ts'].map(f => readFileSync(resolve(process.cwd(), 'src/features/attention', f), 'utf8'))
    for (const source of sources)
      expect(source).not.toMatch(/features\/localscope|useLocalMachine|useSystemResources/)
  })
})

describe('attention model — identity', () => {
  // H
  it('keeps an item whose workspace could not be resolved, with identity null rather than guessed', () => {
    const [item] = queue({ agents: [makeAgent({ workspace: null, awaitingTerminalPermission: true })] })
    expect(item).toMatchObject({ workspace: null, repository: null, level: 'blocking' })
  })

  it('carries the resolved workspace and its repository', () => {
    const [item] = queue({ agents: [makeAgent({ awaitingTerminalPermission: true })] })
    expect(item.workspace?.id).toBe('ws-main')
    expect(item.repository?.name).toBe('Agent-Dashboard')
  })

  it('names an agent by its task or provider and session, never by folder', () => {
    expect(agentTitle(makeAgent({ pipelineTaskTitle: 'Fix login' }))).toBe('Fix login')
    const title = agentTitle(makeAgent({ sessionId: '3f2a1b9c-0000-4000-8000-000000000000' }))
    expect(title).toBe('Claude session 3f2a1b9c')
    expect(title).not.toContain('project')
  })
})

describe('attention model — ordering', () => {
  // I
  it('orders by level, then oldest request first, then untimed items by id', () => {
    const items = queue({
      agents: [
        makeAgent({ sessionId: 'failed', errorState: 'quota_exhausted' }),
        makeAgent({ sessionId: 'new-perm', heldPermissions: [permission({ requestedAt: ago(2) })] }),
        makeAgent({ sessionId: 'old-perm', heldPermissions: [permission({ requestedAt: ago(20) })] }),
        makeAgent({ sessionId: 'b-terminal', awaitingTerminalPermission: true }),
        makeAgent({ sessionId: 'a-question', pendingConfirm: { question: '', options: [] } }),
      ],
      tasks: [task({ id: 'review' })],
    })
    expect(items.map(i => i.id)).toEqual([
      'agent:old-perm',
      'agent:new-perm',
      'agent:a-question',
      'agent:b-terminal',
      'agent:failed',
      'task:review',
    ])
  })

  it('never fabricates a time from an unparseable timestamp', () => {
    const [item] = queue({ agents: [makeAgent({ heldPermissions: [permission({ requestedAt: 'not-a-date' })] })] })
    expect(item.since).toBeNull()
  })

  it('is deterministic for identical input', () => {
    const agents = [makeAgent({ sessionId: 'b', awaitingTerminalPermission: true }), makeAgent({ sessionId: 'a', awaitingTerminalPermission: true })]
    expect(queue({ agents }).map(i => i.id)).toEqual(queue({ agents: [...agents].reverse() }).map(i => i.id))
    expect([...queue({ agents })].sort(compareAttention).map(i => i.id)).toEqual(['agent:a', 'agent:b'])
  })
})

describe('attention model — deduplication', () => {
  // J
  it('counts a held call and its lapsed terminal prompt on one session once', () => {
    const items = queue({ agents: [makeAgent({ heldPermissions: [permission()], awaitingTerminalPermission: true })] })
    expect(items).toHaveLength(1)
  })

  it('folds a task\'s permission requests into the agent blocked on them, keeping the older time', () => {
    const olderRequest = ago(15)
    const agent = makeAgent({ pipelineTaskId: 't1', pendingPermissions: [permission({ requestedAt: ago(4) })] })
    const items = queue({ agents: [agent], permissionItems: [permissionItem('t1', olderRequest)], tasks: [task({ id: 't1' })] })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'agent:sess-a', since: olderRequest })
  })

  it('does not add a waiting-task item for a task whose run is already blocking', () => {
    const agent = makeAgent({ pipelineTaskId: 't1', pendingQuestion: { header: '', question: 'q', multiSelect: false, options: [], typeSomethingIndex: 1, chatAboutIndex: 2 } })
    expect(queue({ agents: [agent], tasks: [task({ id: 't1' })] })).toHaveLength(1)
  })

  // K
  it('keeps genuinely different conditions separate', () => {
    const questionOnT1 = makeAgent({ sessionId: 'q', pipelineTaskId: 't1', pendingQuestion: { header: '', question: 'q', multiSelect: false, options: [], typeSomethingIndex: 1, chatAboutIndex: 2 } })
    const otherAgent = makeAgent({ sessionId: 'p', heldPermissions: [permission()] })
    const items = queue({
      agents: [questionOnT1, otherAgent],
      permissionItems: [permissionItem('t1')],
      capabilityDecisions: [capability()],
      tasks: [task({ id: 't2' })],
    })
    expect(items.map(i => i.id).sort()).toEqual(['agent:p', 'agent:q', 'capability:cap-1', 'task:t1', 'task:t2'])
  })
})

describe('attention queue state', () => {
  const items = queue({ agents: [makeAgent({ awaitingTerminalPermission: true })] })

  // M
  it('is loading, with no items, before any agent observation — never an empty queue', () => {
    expect(attentionQueueState({ items, agentsObserved: false, agentsError: null, tasksLoading: false, live: true }))
      .toEqual({ status: 'loading', stale: false, items: [] })
  })

  it('is unavailable when the first agent read failed and nothing was ever observed', () => {
    expect(attentionQueueState({ items, agentsObserved: false, agentsError: 'HTTP 503', tasksLoading: false, live: false }).status).toBe('unavailable')
  })

  it('stays loading until tasks have loaded, since tasks feed the queue too', () => {
    expect(attentionQueueState({ items, agentsObserved: true, agentsError: null, tasksLoading: true, live: true }).status).toBe('loading')
  })

  // N
  it('keeps last-known items while agent updates reconnect', () => {
    expect(attentionQueueState({ items, agentsObserved: true, agentsError: null, tasksLoading: false, live: false }))
      .toMatchObject({ status: 'ready', stale: true, items })
  })
})

describe('attention model — privacy', () => {
  // P
  it('carries no path, command, question text or transcript into an item', () => {
    const leaky = makeAgent({
      cwd: '/Users/someone/secret-client/repo',
      projectPath: '/Users/someone/secret-client/repo',
      lastOutput: 'transcript: the deploy key is abc123',
      pendingQuestion: { header: 'hdr', question: 'Paste the production token?', multiSelect: false, options: [], typeSomethingIndex: 1, chatAboutIndex: 2 },
      heldPermissions: [permission({ pattern: 'curl -H "Authorization: Bearer xyz" https://internal' })],
      pendingToolUse: { id: 'tu', tool: 'Bash', pattern: 'cat ~/.ssh/id_rsa', patternDisplay: 'cat ~/.ssh/id_rsa' },
    })
    const items = queue({ agents: [leaky], capabilityDecisions: [capability({ value: '/etc/secret/path', context: 'repo:/Users/someone' })] })
    const text = JSON.stringify(items.map(({ title, reason, detail }) => ({ title, reason, detail })))
    for (const secret of ['/Users/', 'secret-client', 'transcript', 'production token', 'Bearer', 'id_rsa', '/etc/secret', 'someone@example.com'])
      expect(text).not.toContain(secret)
  })
})
