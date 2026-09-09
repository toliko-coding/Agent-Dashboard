import type { Agent } from '@/types'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

function agentAt(cwd: string, id = cwd): Agent {
  return { cwd, sessionId: id, projectName: cwd.split('/').pop() } as Agent
}

function svc(over: Record<string, unknown>) {
  return { id: 's', port: 5173, label: 'Vite Development Server', cwd: null, discoveredProject: null, ...over }
}

/*
 * `reachable: false` now means the normalized list is unknown — items: null —
 * which is the same claim the raw resource's reachable flag used to carry.
 */
async function mountChips(agent: Agent, state: { reachable?: boolean | null, error?: string | null, data?: any[] | null } = {}) {
  vi.resetModules()
  const known = state.reachable !== false && !state.error
  vi.doMock('@/features/localscope', () => ({
    useMachineServices: () => ({
      data: {
        value: {
          source: known ? 'ok' : 'unavailable',
          collectedAt: null,
          ageMs: null,
          degraded: [],
          items: known ? (state.data === undefined ? [] : state.data) : null,
        },
      },
      loaded: { value: true },
      refetch: async () => {},
    }),
  }))
  const C = (await import('../AgentServiceChips.vue')).default
  return mount(C, { props: { agent } })
}

describe('agentServiceChips', () => {
  it('shows a port chip per correlated service', async () => {
    const w = await mountChips(agentAt('/gh/LocalScope'), {
      data: [
        svc({ id: 'a', port: 5173, discoveredProject: { rootPath: '/gh/LocalScope' } }),
        svc({ id: 'b', port: 7317, discoveredProject: { rootPath: '/gh/LocalScope' } }),
      ],
    })
    expect(w.get('[data-testid="agent-service-5173"]').text()).toContain(':5173')
    expect(w.get('[data-testid="agent-service-7317"]').text()).toContain(':7317')
  })

  it('caps the chips and counts the rest, keeping the card compact', async () => {
    const w = await mountChips(agentAt('/gh/P'), {
      data: [1, 2, 3, 4].map(n => svc({ id: `s${n}`, port: 3000 + n, discoveredProject: { rootPath: '/gh/P' } })),
    })
    expect(w.findAll('[data-testid^="agent-service-3"]')).toHaveLength(2)
    expect(w.get('[data-testid="agent-service-overflow"]').text()).toBe('+2')
  })

  it('renders nothing when the project has no service', async () => {
    const w = await mountChips(agentAt('/gh/Quiet'), {
      data: [svc({ id: 'a', discoveredProject: { rootPath: '/gh/Elsewhere' } })],
    })
    expect(w.find('[data-testid="agent-service-chips"]').exists()).toBe(false)
    // Specifically not a zero: nothing here can distinguish "collected and none
    // belong to this project" from "this project was not represented".
    expect(w.text()).not.toContain('0')
  })

  // The collector being down is already stated on Overview and the LocalScope
  // view; repeating it once per card would add nothing.
  it('renders nothing — and no error badge — when LocalScope is down', async () => {
    const w = await mountChips(agentAt('/gh/LocalScope'), { reachable: false, data: null })
    expect(w.find('[data-testid="agent-service-chips"]').exists()).toBe(false)
    expect(w.text().toLowerCase()).not.toContain('error')
    expect(w.text().toLowerCase()).not.toContain('unavailable')
    expect(w.html()).not.toContain('danger')
  })

  it('renders nothing when the collector errored', async () => {
    const w = await mountChips(agentAt('/gh/LocalScope'), { error: 'boom', data: [] })
    expect(w.find('[data-testid="agent-service-chips"]').exists()).toBe(false)
  })

  /*
   * Interaction: a chip opens the service, but only when LocalScope actually
   * reported a URL. The collector sets url to null for a non-HTTP listener, so
   * building http://localhost:<port> would point the user at a database or an
   * inspector socket.
   */
  it('links a chip to the URL LocalScope reported', async () => {
    const w = await mountChips(agentAt('/gh/LocalScope'), {
      data: [svc({ id: 'a', port: 5173, url: 'http://localhost:5173', discoveredProject: { rootPath: '/gh/LocalScope' } })],
    })
    const chip = w.get('[data-testid="agent-service-5173"]')
    expect(chip.element.tagName).toBe('A')
    expect(chip.attributes('href')).toBe('http://localhost:5173')
    expect(chip.attributes('target')).toBe('_blank')
    expect(chip.attributes('rel')).toContain('noopener')
    expect(chip.attributes('aria-label')).toContain('Open Vite Development Server')
  })

  it('does not link — or invent a URL for — a service with none', async () => {
    const w = await mountChips(agentAt('/gh/LocalScope'), {
      data: [svc({ id: 'b', port: 5432, label: 'database', url: null, discoveredProject: { rootPath: '/gh/LocalScope' } })],
    })
    const chip = w.get('[data-testid="agent-service-5432"]')
    expect(chip.element.tagName).not.toBe('A')
    expect(w.html()).not.toContain('localhost:5432')
    expect(chip.attributes('title')).toContain('database on port 5432')
  })

  // The card opens the workspace on click; a chip must not do both.
  it('keeps a chip click off the surrounding card', async () => {
    const onCard = vi.fn()
    const state = { data: [svc({ id: 'a', port: 5173, url: 'http://localhost:5173', discoveredProject: { rootPath: '/gh/X' } })] }
    vi.resetModules()
    vi.doMock('@/features/localscope', () => ({
      useMachineServices: () => ({
        data: {
          value: {
            source: 'ok',
            collectedAt: null,
            ageMs: null,
            degraded: [],
            items: state.data,
          },
        },
        loaded: { value: true },
        refetch: async () => {},
      }),
    }))
    const Chips = (await import('../AgentServiceChips.vue')).default
    const w = mount({
      components: { Chips },
      setup: () => ({ onCard, agent: agentAt('/gh/X') }),
      template: '<div @click="onCard"><Chips :agent="agent" /></div>',
    })
    await w.get('[data-testid="agent-service-5173"]').trigger('click')
    expect(onCard).not.toHaveBeenCalled()
  })

  it('describes the services for assistive tech', async () => {
    const w = await mountChips(agentAt('/gh/LocalScope'), {
      data: [svc({ id: 'a', port: 5173, discoveredProject: { rootPath: '/gh/LocalScope' } })],
    })
    expect(w.get('.sr-only').text()).toContain('Vite Development Server on port 5173')
  })
})

/*
 * The performance requirement: a roster renders one card per agent, and the
 * collector must still see one request. This mounts many chips against the
 * REAL shared resource (only fetch is stubbed) and counts network calls.
 */
describe('agentServiceChips — shared resource', () => {
  beforeEach(() => {
    // The block above doMock's the feature barrel; this one must exercise the
    // REAL shared resource, so the mock is removed before the modules reload.
    vi.doUnmock('@/features/localscope')
    vi.resetModules()
  })

  it('issues one request no matter how many cards mount', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      // The dashboard's normalized envelope, which is what this resource reads.
      json: async () => ({
        source: 'ok',
        collectedAt: null,
        ageMs: null,
        degraded: [],
        items: [svc({ id: 'a', discoveredProject: { rootPath: '/gh/LocalScope' } })],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const Chips = (await import('../AgentServiceChips.vue')).default
    const Roster = defineComponent({
      setup() {
        const agents = [
          agentAt('/gh/LocalScope', '1'),
          agentAt('/gh/LocalScope/packages/web', '2'),
          agentAt('/gh/Other', '3'),
          agentAt('/gh/Another', '4'),
          agentAt('/gh/Fifth', '5'),
        ]
        return () => h('div', agents.map(a => h(Chips, { agent: a, key: a.sessionId })))
      },
    })

    const w = mount(Roster)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const calls = fetchMock.mock.calls as unknown as unknown[][]
    const localScopeCalls = calls.filter(c => String(c[0]).includes('/localscope/'))
    expect(localScopeCalls.length).toBe(1)
    w.unmount()
  })

  it('stops polling once the last card unmounts', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ source: 'ok', collectedAt: null, ageMs: null, degraded: [], items: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const Chips = (await import('../AgentServiceChips.vue')).default
    const w = mount(defineComponent({
      setup: () => () => h('div', [h(Chips, { agent: agentAt('/gh/A') }), h(Chips, { agent: agentAt('/gh/B') })]),
    }))
    await vi.advanceTimersByTimeAsync(12000)
    const during = fetchMock.mock.calls.length
    expect(during).toBeGreaterThan(1)

    w.unmount()
    await vi.advanceTimersByTimeAsync(20000)
    expect(fetchMock.mock.calls.length).toBe(during)
    vi.useRealTimers()
  })
})
