import type { AttentionQueue } from './queue'
import type { PendingCapabilityDecision } from '@/sdk.generated'
import type { Agent, PipelineTask } from '@/types'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { AgentTriageBand } from '@/features/agents'
import NeedsYouBand from './components/NeedsYouBand.vue'
import { attentionQueueState, buildAttentionQueue } from './queue'

vi.mock('@/composables/useToast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

/*
 * 3D: one attention queue, one count. The Overview band, the sidebar badge and
 * the Agents triage all read the queue App.vue derives, and nothing else in the
 * app decides whether something needs the user.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      return sourceFiles(path)
    return /\.(?:ts|vue)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

function agent(o: Partial<Agent>): Agent {
  return {
    pid: 1,
    sessionId: 's',
    provider: 'claude',
    projectName: 'demo',
    projectPath: '/Users/someone/secret-client/demo',
    cwd: '/Users/someone/secret-client/demo',
    status: 'active',
    working: false,
    entrypoint: 'cli',
    lastActivity: new Date().toISOString(),
    uptime: 60,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    costEstimate: 0,
    healthScore: 100,
    toolCounts: {},
    lastTools: [],
    tasks: [],
    subagents: [],
    meta: null,
    workspace: null,
    ...o,
  } as unknown as Agent
}

const AGENTS = [
  agent({ sessionId: 'held', heldPermissions: [{ id: 'h', tool: 'Bash', pattern: 'git push --force', requestedAt: new Date().toISOString() }] }),
  agent({ sessionId: 'failed', errorState: 'rate_limited' }),
  agent({ sessionId: 'idle', status: 'idle' }),
  agent({ sessionId: 'working', working: true, pendingToolUse: { id: 't', tool: 'Bash', pattern: 'npm test', patternDisplay: 'npm test' } }),
  agent({ sessionId: 'silent', lastActivity: new Date(Date.now() - 45 * 60_000).toISOString(), pendingToolUse: { id: 't2', tool: 'Bash', pattern: 'make', patternDisplay: 'make' } }),
]
const DECISIONS: PendingCapabilityDecision[] = [{ id: 'cap', capability: 'mail.send', value: 'x', context: 'global', reason: '', requestedAt: new Date().toISOString() }]
const TASKS = [{ id: 't-ready', title: 'Refactor billing', currentStage: 'implementation', needsUser: true } as PipelineTask]

function queue(live = true): AttentionQueue {
  const items = buildAttentionQueue({ agents: AGENTS, permissionItems: [], capabilityDecisions: DECISIONS, tasks: TASKS })
  return attentionQueueState({ items, agentsObserved: true, agentsError: null, tasksLoading: false, live })
}

function counts(q: AttentionQueue) {
  const overview = mount(NeedsYouBand, { props: { queue: q } })
  const triage = mount(AgentTriageBand, { props: { queue: q, agents: AGENTS, permissionItems: [], capabilityDecisions: DECISIONS } })
  return {
    overview: overview.get('[data-testid="needs-you-count"]').text(),
    triage: triage.get('[aria-label$="need attention"]').text(),
    overviewLevels: overview.findAll('[data-testid="needs-you-level"]').map(l => l.text()),
    triageText: triage.text(),
    html: overview.html() + triage.find('[data-testid="triage-breakdown"]').html(),
  }
}

describe('one attention queue — wiring (A)', () => {
  it('derives it once in App.vue and hands the same queue to the sidebar, Overview and Agents', () => {
    const app = read('src/App.vue')
    expect(app.match(/useAttentionQueue\(/g)).toHaveLength(1)
    expect(app).toMatch(/const needsYouCount = computed\(\(\) => attention\.value\.items\.length\)/)
    expect(app).toMatch(/:attention-count="needsYouCount"/)
    expect(app).toMatch(/<CockpitView[^>]*:attention="attention"/)
    expect(app).toMatch(/<DashboardView[\s\S]*?:attention="attention"/)
    expect(read('src/features/cockpit/components/CockpitView.vue')).toMatch(/<NeedsYouBand :queue="attention"/)
    expect(read('src/features/cockpit/components/DashboardView.vue')).toMatch(/<AgentTriageBand\s+:queue="attention"/)
  })

  it('leaves no second derivation of attention anywhere in the app', () => {
    const offenders = sourceFiles(resolve(process.cwd(), 'src'))
      .filter(path => !path.includes('/features/attention/'))
      .filter(path => /buildAttentionQueue\(|sortByTriage|needsAttention\(|attentionAgents\s*=\s*computed\(\(\) => sortBy|isStalled\(|STALLED_THRESHOLD_SECONDS/.test(readFileSync(path, 'utf8')))
      .map(path => path.replace(`${process.cwd()}/`, ''))
    expect(offenders).toEqual([])
    expect(read('src/features/agents/composables/useAgents.ts')).not.toMatch(/attentionAgents|attentionCount/)
  })
})

describe('one attention queue — same state, same meaning (B, C, D, E, F, G, H)', () => {
  it('gives the Overview and the Agents triage the same count and the same items', () => {
    const q = queue()
    const c = counts(q)
    // Held permission, failed run, capability decision, ready task. The idle,
    // working and long-silent agents are not attention anywhere.
    expect(q.items.map(i => i.id).sort()).toEqual(['agent:failed', 'agent:held', 'capability:cap', 'task:t-ready'])
    expect(c.overview).toBe('4 waiting')
    expect(c.triage).toBe('4')
    expect(c.overviewLevels).toEqual(['Blocking', 'Blocking', 'Failed', 'Ready'])
    expect(c.triageText).toContain('2 blocking · 1 failed · 1 ready')
    expect(c.triageText).not.toMatch(/stalled|no activity|your turn/i)
  })
})

describe('connection state is not attention (I, J)', () => {
  // I
  it('keeps the same items and count on both surfaces while agent updates reconnect', () => {
    const live = counts(queue(true))
    const reconnecting = counts(queue(false))
    expect(reconnecting.overview).toBe(live.overview)
    expect(reconnecting.triage).toBe(live.triage)
    expect(reconnecting.overviewLevels).toEqual(live.overviewLevels)
  })

  // J
  it('reads nothing from LocalScope in the queue or in either attention surface', () => {
    for (const path of [
      'src/features/attention/queue.ts',
      'src/features/attention/useAttentionQueue.ts',
      'src/features/attention/components/NeedsYouBand.vue',
      'src/features/agents/components/AgentTriageBand.vue',
      'src/utils/attention.ts',
    ])
      expect(read(path), path).not.toMatch(/features\/localscope|useLocalMachine|useSystemResources/)
  })
})

describe('privacy (M)', () => {
  it('shows no path in the Overview band or the triage summary for the same state', () => {
    const c = counts(queue())
    expect(c.html).not.toContain('/Users/someone')
    expect(c.html).not.toContain('secret-client')
    expect(c.html).not.toContain('git push --force')
  })
})
