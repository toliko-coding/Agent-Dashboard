import type { ActivityEvent } from '@/utils/activityEvents'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import { axe } from '@/utils/testA11y'

const events = shallowRef<ActivityEvent[]>([])
const isLoading = ref(false)
const loaded = ref(true)
const error = ref<string | null>(null)

vi.mock('@/composables/useActivityFeed', () => ({
  useActivityFeed: () => ({ events, isLoading, loaded, error, refetch: vi.fn() }),
}))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
function event(o: Partial<ActivityEvent>): ActivityEvent {
  const raw = o.timestampRaw ?? minutesAgo(2)
  return { id: Math.random().toString(36), timestamp: Date.parse(raw), timestampRaw: raw, actor: 'user', action: 'spawn', title: 'Agent spawned', severity: 'success', ...o }
}

async function render(attach = false) {
  const { default: ActivityFeedPanel } = await import('./ActivityFeedPanel.vue')
  return mount(ActivityFeedPanel, { attachTo: attach ? document.body : undefined })
}

describe('activityFeedPanel', () => {
  it('says what will appear when nothing has been recorded', async () => {
    events.value = []
    const w = await render()
    expect(w.get('[data-testid="cockpit-activity-empty"]').text()).toContain('No recorded activity yet')
  })

  it('states each event\'s severity, actor and relative time', async () => {
    events.value = [
      event({ action: 'spawn_rejected', title: 'Agent spawn rejected', severity: 'danger', actor: 'system', timestampRaw: minutesAgo(5) }),
      event({ action: 'live_inject', title: 'Message sent to agent', severity: 'info', actor: 'user', timestampRaw: minutesAgo(1) }),
    ]
    const w = await render()
    const rejected = w.get('[data-testid="activity-spawn_rejected"]')
    expect(rejected.attributes('data-severity')).toBe('danger')
    expect(rejected.get('.sr-only').text()).toContain('refused')
    expect(rejected.get('[data-testid="activity-actor"]').text()).toBe('System')
    // Relative to the page's shared 30s clock, so it may read a minute short.
    expect(rejected.get('[data-testid="activity-when"]').text()).toMatch(/^[45]m ago$/)
    expect(w.get('[data-testid="activity-live_inject"] [data-testid="activity-actor"]').text()).toBe('You')
  })

  it('opens the task an event belongs to', async () => {
    events.value = [event({ action: 'task_done', title: 'Task completed', taskId: 'task-42' })]
    const w = await render()
    await w.get('[data-testid="activity-open-task"]').trigger('click')
    expect(w.emitted('openTask')).toEqual([['task-42']])
  })

  it('shows no audit target identifiers', async () => {
    events.value = [event({ action: 'live_inject', title: 'Message sent to agent', detail: 'pid:918273' })]
    const w = await render()
    expect(w.text()).not.toContain('918273')
  })

  it('shows a date instead of a large hour count for older events', async () => {
    events.value = [event({ timestampRaw: minutesAgo(60 * 50) })]
    const w = await render()
    expect(w.get('[data-testid="activity-when"]').text()).not.toMatch(/h \d+m ago/)
  })

  it('has no axe violations', async () => {
    events.value = [event({ taskId: 't1', action: 'task_done', title: 'Task completed' }), event({ action: 'spawn' })]
    const w = await render(true)
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
