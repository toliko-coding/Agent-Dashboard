import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrchestrationsView from '../OrchestrationsView.vue'

/*
 * Drives the view against a stubbed fetch, so the rendered strings a person
 * actually reads are asserted — not just the layout arithmetic the sibling
 * suite covers.
 */

const SUMMARY = {
  rootTaskId: 'root-1',
  title: 'Ship the exporter',
  slug: 'ship-the-exporter',
  projectId: null,
  counts: { total: 3, done: 1, cancelled: 2, blocked: 0, active: 2 },
  spawnerIds: ['coder'],
  delegated: 1,
  updatedAt: '2026-01-01T00:00:00Z',
}

const DETAIL = {
  ...SUMMARY,
  tasks: [
    {
      id: 'root-1',
      slug: 'ship-the-exporter',
      title: 'Ship the exporter',
      stage: 'implementation',
      priority: 'high',
      parentTaskId: null,
      delegatedByStageRunId: null,
      spawnerId: 'coder',
      projectId: null,
      depth: 0,
    },
    {
      id: 'child-a',
      slug: 'write-the-schema',
      title: 'Write the schema',
      stage: 'done',
      priority: 'medium',
      parentTaskId: 'root-1',
      delegatedByStageRunId: 'run-1',
      spawnerId: 'coder',
      projectId: null,
      depth: 1,
    },
    {
      id: 'child-b',
      slug: 'write-the-writer',
      title: 'Write the writer',
      stage: 'implementation',
      priority: 'medium',
      parentTaskId: 'root-1',
      delegatedByStageRunId: null,
      spawnerId: null,
      projectId: null,
      depth: 1,
    },
  ],
  dependencies: [
    { id: 'dep-1', taskId: 'child-b', dependsOnId: 'child-a', requiredStage: 'done' },
  ],
}

function stubFetch(list: unknown[], detail: unknown = DETAIL) {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    const body = url.startsWith('/api/orchestrations/')
      ? detail
      : url.startsWith('/api/orchestrations')
        ? list
        : []
    return { ok: true, json: async () => body } as Response
  }))
}

async function mountView() {
  const w = mount(OrchestrationsView, { attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return w
}

describe('orchestrationsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // An empty list must state WHY it is empty. A bare zero would read as
  // "checked, found none" for a question the view never asked.
  it('explains that childless tasks are not listed', async () => {
    stubFetch([])
    const w = await mountView()
    expect(w.find('[data-testid="view-placeholder"]').exists()).toBe(true)
    expect(w.text()).toContain('sub-tasks')
  })

  it('lists an orchestration with its stored counts', async () => {
    stubFetch([SUMMARY])
    const w = await mountView()
    expect(w.find('[data-testid="view-placeholder"]').exists()).toBe(false)
    expect(w.text()).toContain('Ship the exporter')
    expect(w.text()).toContain('ship-the-exporter')
  })

  // Cancelled is terminal but undelivered; folding it into "done" would
  // overstate what the orchestration achieved.
  it('states cancelled separately from done', async () => {
    stubFetch([SUMMARY])
    const w = await mountView()
    expect(w.text()).toContain('2 cancelled')
  })

  it('says no role is assigned rather than leaving it blank', async () => {
    stubFetch([{ ...SUMMARY, spawnerIds: [] }])
    const w = await mountView()
    expect(w.text()).toContain('No role assigned')
  })

  it('opens the detail graph on selection', async () => {
    stubFetch([SUMMARY])
    const w = await mountView()
    await w.find('button').trigger('click')
    await flushPromises()
    expect(w.find('svg[role="img"]').exists()).toBe(true)
    expect(w.text()).toContain('Delegation (parent → child)')
    expect(w.text()).toContain('Dependency (must finish first)')
  })

  it('names the creator honestly for a delegated and a human-created task', async () => {
    stubFetch([SUMMARY])
    const w = await mountView()
    await w.find('button').trigger('click')
    await flushPromises()

    const rows = w.findAll('button').filter(b => b.text().includes('Write the schema'))
    await rows[rows.length - 1].trigger('click')
    expect(w.text()).toContain('stage run run-1')

    const others = w.findAll('button').filter(b => b.text().includes('Write the writer'))
    await others[others.length - 1].trigger('click')
    expect(w.text()).toContain('a person (not delegated by an agent)')
    expect(w.text()).toContain('unassigned')
  })

  // This phase adds no agent authority: the view can show delegation, never
  // cause it.
  it('offers no control that would start or change work', async () => {
    stubFetch([SUMMARY])
    const w = await mountView()
    await w.find('button').trigger('click')
    await flushPromises()

    const forbidden = /\b(?:delegate|spawn|advance|cancel task|retry|approve)\b/i
    for (const b of w.findAll('button'))
      expect(b.text()).not.toMatch(forbidden)
  })

  // Every request this view makes is a GET.
  it('never issues a mutating request', async () => {
    stubFetch([SUMMARY])
    const w = await mountView()
    await w.find('button').trigger('click')
    await flushPromises()

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    for (const [, init] of calls) {
      const method = (init as RequestInit | undefined)?.method
      expect(method === undefined || method === 'GET').toBe(true)
    }
  })
})
