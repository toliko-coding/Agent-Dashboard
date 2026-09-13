import type { AttentionItem, AttentionQueue } from '@/features/attention'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const agent = { sessionId: 'sess-blocked', pid: 7 }
const selectAgent = vi.fn()
const activeView = ref('cockpit')

vi.mock('@/features/agents', () => ({
  useAgents: () => ({ agents: ref([agent]), selectAgent }),
}))
vi.mock('@/composables/useViewState', () => ({
  useViewState: () => ({ activeView }),
}))
// The existing panels are out of scope here and fetch on mount.
for (const panel of ['ActivityFeedPanel', 'AgentsPanel', 'GitHubPanel', 'MemoryPanel', 'OverviewMetrics', 'PipelinePanel', 'ProjectsSummaryPanel', 'QuickActionsPanel', 'RoutinesPanel', 'SystemMap', 'SystemResourcesPanel'])
  vi.doMock(`./${panel}.vue`, () => ({ default: { name: panel, template: `<div data-testid="stub-${panel}" />` } }))

function item(subject: AttentionItem['subject'], id: string): AttentionItem {
  return { id, level: 'blocking', kind: 'permission', subject, agentSessionId: null, workspace: null, repository: null, title: id, reason: 'Permission request waiting', since: null, lastActivity: null }
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

async function render() {
  const { default: CockpitView } = await import('./CockpitView.vue')
  return mount(CockpitView, { props: { attention: queue }, attachTo: document.body })
}

describe('cockpitView — Needs you', () => {
  beforeEach(() => {
    selectAgent.mockClear()
    activeView.value = 'cockpit'
  })

  it('puts Needs you above every existing panel', async () => {
    const w = await render()
    const children = [...w.get('[data-testid="cockpit"]').element.children]
    expect(children[0].getAttribute('data-testid')).toBe('needs-you')
    expect(children[1].getAttribute('data-testid')).toBe('stub-OverviewMetrics')
    w.unmount()
  })

  // O
  it('opens the agent\'s existing detail modal for an agent item', async () => {
    const w = await render()
    await w.findAll('[data-testid="needs-you-item"]')[0].trigger('click')
    expect(selectAgent).toHaveBeenCalledWith(agent)
    w.unmount()
  })

  it('asks App to open the task for a task item', async () => {
    const w = await render()
    await w.findAll('[data-testid="needs-you-item"]')[1].trigger('click')
    expect(w.emitted('openTask')).toEqual([['task-9']])
    expect(selectAgent).not.toHaveBeenCalled()
    w.unmount()
  })

  it('goes to the Agents view, where capability decisions are answered, for a capability item', async () => {
    const w = await render()
    await w.findAll('[data-testid="needs-you-item"]')[2].trigger('click')
    expect(activeView.value).toBe('dashboard')
    w.unmount()
  })
})
