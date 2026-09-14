import type { AttentionItem, AttentionQueue } from '@/features/attention'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const WORKSPACE = { id: 'ws-1', name: 'web', kind: 'git-main', branch: 'main', repository: { id: 'repo-1', name: 'web' } }
const blockedAgent = { sessionId: 'sess-blocked', pid: 7, status: 'active', working: true, workspace: WORKSPACE, subagents: [], lastActivity: new Date().toISOString() }
const workingAgent = { sessionId: 'sess-working', pid: 8, status: 'active', working: true, workspace: WORKSPACE, subagents: [], lastActivity: new Date().toISOString() }
const idleAgent = { sessionId: 'sess-idle', pid: 9, status: 'idle', working: false, workspace: WORKSPACE, subagents: [], lastActivity: new Date().toISOString() }
const selectAgent = vi.fn()
const activeView = ref('cockpit')
const live = ref(true)
const lastUpdatedAt = ref<number | null>(Date.now())

vi.mock('@/features/agents', () => ({
  useAgents: () => ({ agents: ref([blockedAgent, workingAgent, idleAgent]), selectAgent, live, lastUpdatedAt }),
}))
vi.mock('@/composables/useViewState', () => ({
  useViewState: () => ({ activeView }),
}))
// Panels with their own fetches and their own tests; here only their place matters.
for (const panel of ['ActivityFeedPanel', 'ClaudeUsagePanel', 'CommandHero', 'GitHubPanel', 'MachineResourcesPanel', 'MemoryPanel', 'PipelinePanel', 'ProjectsSummaryPanel', 'RoutinesPanel', 'RuntimeSection', 'CommandStatusStrip'])
  vi.doMock(`./${panel}.vue`, () => ({ default: { name: panel, template: `<section data-testid="stub-${panel}" />` } }))

function item(subject: AttentionItem['subject'], id: string): AttentionItem {
  return { id, level: 'blocking', kind: 'permission', subject, agentSessionId: subject.type === 'agent' ? subject.sessionId : null, workspace: null, repository: null, title: id, reason: 'Permission request waiting', since: null, lastActivity: null }
}

const queue: AttentionQueue = {
  status: 'ready',
  stale: false,
  items: [
    item({ type: 'agent', sessionId: 'sess-blocked' }, 'agent:sess-blocked'),
    item({ type: 'task', taskId: 'task-9' }, 'task:task-9'),
    item({ type: 'capability', decisionId: 'cap-1' }, 'capability:cap-1'),
  ],
}

async function render(attention: AttentionQueue = queue) {
  const { default: CockpitView } = await import('./CockpitView.vue')
  return mount(CockpitView, { props: { attention }, attachTo: document.body })
}

function order(w: Awaited<ReturnType<typeof render>>) {
  return [...w.get('[data-testid="cockpit"]').element.children].map(c => c.getAttribute('data-testid'))
}

describe('command page — layout', () => {
  beforeEach(() => {
    selectAgent.mockClear()
    activeView.value = 'cockpit'
    live.value = true
    lastUpdatedAt.value = Date.now()
  })

  it('answers in order: status, what needs me, what is working, the runtime, then the rest', async () => {
    const w = await render()
    expect(order(w)).toEqual(['stub-CommandHero', 'stub-CommandStatusStrip', 'needs-you', 'command-main', 'command-secondary', 'command-integrations'])
    const children = (id: string) => [...w.get(`[data-testid="${id}"]`).element.children].map(c => c.getAttribute('data-testid'))
    expect(children('command-main')).toEqual(['command-primary', 'command-rail'])
    expect(children('command-primary')).toEqual(['active-work', 'stub-RuntimeSection'])
    w.unmount()
  })

  // 3N: usage, the machine and recent activity sit beside the work, after it in reading order.
  it('puts Claude usage, this machine and recent activity in a labelled rail after the work', async () => {
    const w = await render()
    const rail = w.get('[data-testid="command-rail"]')
    expect(rail.element.tagName).toBe('ASIDE')
    expect(rail.attributes('aria-label')).toBe('Usage, this machine and recent activity')
    expect([...rail.element.children].map(c => c.getAttribute('data-testid'))).toEqual(['stub-ClaudeUsagePanel', 'stub-MachineResourcesPanel', 'stub-ActivityFeedPanel'])
    w.unmount()
  })

  it('lists the working agent in Active work, and not the one Needs you already shows or the idle one', async () => {
    const w = await render()
    const rows = w.findAll('[data-testid="active-work-agent"]')
    expect(rows).toHaveLength(1)
    expect(w.get('[data-testid="active-work-count"]').text()).toBe('1 working')
    w.unmount()
  })

  it('shows last-known work, marked, while agent updates reconnect', async () => {
    live.value = false
    const w = await render()
    expect(w.find('[data-testid="active-work-stale"]').exists()).toBe(true)
    w.unmount()
  })

  it('does not report nobody working before agents are observed', async () => {
    lastUpdatedAt.value = null
    const w = await render({ status: 'loading', stale: false, items: [] })
    expect(w.find('[data-testid="active-work-loading"]').exists()).toBe(true)
    expect(w.find('[data-testid="active-work-empty"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('command page — interaction', () => {
  beforeEach(() => {
    selectAgent.mockClear()
    activeView.value = 'cockpit'
    live.value = true
    lastUpdatedAt.value = Date.now()
  })

  it('opens the agent\'s existing detail modal for an attention item', async () => {
    const w = await render()
    await w.findAll('[data-testid="needs-you-item"]')[0].trigger('click')
    expect(selectAgent).toHaveBeenCalledWith(blockedAgent)
    w.unmount()
  })

  it('asks App to open the task for a task item', async () => {
    const w = await render()
    await w.findAll('[data-testid="needs-you-item"]')[1].trigger('click')
    expect(w.emitted('openTask')).toEqual([['task-9']])
    w.unmount()
  })

  it('goes to the Agents view, where capability decisions are answered, for a capability item', async () => {
    const w = await render()
    await w.findAll('[data-testid="needs-you-item"]')[2].trigger('click')
    expect(activeView.value).toBe('dashboard')
    w.unmount()
  })

  it('opens a working agent\'s details from its Active work row', async () => {
    const w = await render()
    await w.get('[data-testid="active-work-agent"]').trigger('click')
    expect(selectAgent).toHaveBeenCalledWith(workingAgent)
    w.unmount()
  })
})

describe('command page — retirements (3E)', () => {
  const source = () => readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/CockpitView.vue'), 'utf8')

  it('keeps the duplicate panels retired', () => {
    for (const retired of ['OverviewMetrics', 'SystemMap', 'QuickActionsPanel', 'AgentsPanel', 'SystemResourcesPanel']) {
      expect(source(), retired).not.toMatch(new RegExp(`import ${retired}\\b`))
      expect(existsSync(resolve(process.cwd(), `src/features/cockpit/components/${retired}.vue`)), retired).toBe(false)
    }
  })

  it('shows no audit target identifiers (task ids, PIDs) in Recent activity', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/features/cockpit/components/ActivityFeedPanel.vue'), 'utf8')
    expect(panel).not.toMatch(/e\.detail/)
  })

  it('never calls session cost today\'s spend', () => {
    expect(source()).not.toMatch(/\btoday\b/i)
    expect(readFileSync(resolve(process.cwd(), 'src/components/shell/GroupHeader.vue'), 'utf8')).not.toMatch(/\}\}\s*today/)
  })
})
