import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMainAgentRecordForTest } from '../../composables/useMainAgentRecord'
import MainAgentPanel from '../MainAgentPanel.vue'

/*
 * The agent that maintains Agent Dashboard, shown as itself.
 *
 * It is a durable record, so the panel exists whether or not a session is
 * running it. Underneath it is an ordinary session with ordinary rules: the
 * panel invents no activity, and linking a session grants it nothing.
 */

const MAIN = {
  agentId: 'main',
  displayName: 'Agent Dashboard Manager',
  category: 'development',
  instructions: '',
  permissionMode: '',
  cwd: '/repo/agent-dashboard',
  sessionId: '',
}

function agent(o: Partial<Agent> = {}) {
  return ({
    pid: 79189,
    sessionId: 'sess-manager',
    provider: 'claude',
    status: 'active',
    title: 'Dashboard work',
    cwd: '/repo/agent-dashboard',
    ...o,
  }) as Agent
}

let record: Record<string, unknown>
let posts: Array<Record<string, unknown>>

function stubFetch() {
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}'))
      posts.push(body)
      record = { ...record, sessionId: body.pid === 0 ? '' : 'sess-manager' }
      return { ok: true, json: async () => record }
    }
    return { ok: true, json: async () => record }
  }))
}

async function mountPanel(agents: Agent[]) {
  const w = mount(MainAgentPanel, { props: { agents }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return w
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

beforeEach(() => {
  record = { ...MAIN }
  resetMainAgentRecordForTest()
  stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  resetMainAgentRecordForTest()
})

describe('main agent panel', () => {
  it('shows the agent even when no session is running it', async () => {
    const w = await mountPanel([])
    expect(q('main-agent-name')!.textContent).toContain('Agent Dashboard Manager')
    expect(q('main-agent-badge')!.textContent).toContain('Main agent')
    expect(q('main-agent-description')!.textContent).toContain('grants no access')
    expect(q('main-agent-no-session')!.textContent).toContain('No session running')
    w.unmount()
  })

  it('shows the running session and opens it', async () => {
    record = { ...MAIN, sessionId: 'sess-manager' }
    const live = agent()
    const w = await mountPanel([live])

    expect(q('main-agent-session')!.textContent).toContain('Dashboard work')
    expect(q('main-agent-no-session')).toBeNull()
    q('main-agent-open')!.click()
    await flushPromises()
    expect(w.emitted('select')?.[0]).toEqual([live])
    w.unmount()
  })

  /*
   * Linking says which session is running the main agent. It is offered only
   * for sessions in the agent's own folder, so this cannot become a way to
   * designate any agent as main.
   */
  it('offers only sessions from the main agent\'s own folder', async () => {
    const elsewhere = agent({ pid: 29194, sessionId: 'sess-portfolio', cwd: '/repo/portfolio', title: 'Portfolio Developer' })
    const w = await mountPanel([agent(), elsewhere])

    expect(q('main-agent-link-79189')).not.toBeNull()
    expect(q('main-agent-link-29194')).toBeNull()
    w.unmount()
  })

  it('records the chosen session without claiming anything else about it', async () => {
    const w = await mountPanel([agent()])
    q('main-agent-link-79189')!.click()
    await flushPromises()

    expect(posts).toEqual([{ pid: 79189 }])
    w.unmount()
  })

  it('offers no linking while a session is already running it', async () => {
    record = { ...MAIN, sessionId: 'sess-manager' }
    const w = await mountPanel([agent()])
    expect(q('main-agent-link')).toBeNull()
    w.unmount()
  })

  // A finished session is not a running one: the panel says so rather than
  // showing a dead process as the live maintainer.
  it('does not treat a finished session as running', async () => {
    record = { ...MAIN, sessionId: 'sess-manager' }
    const w = await mountPanel([agent({ status: 'finished' })])
    expect(q('main-agent-no-session')).not.toBeNull()
    w.unmount()
  })

  it('renders nothing when this server has seeded no main agent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'none' }) })))
    resetMainAgentRecordForTest()
    const w = await mountPanel([agent()])
    expect(q('main-agent-panel')).toBeNull()
    w.unmount()
  })

  it('shows the server\'s refusal rather than pretending the link worked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return { ok: false, status: 403, json: async () => ({ error: 'Only a Claude session on this machine can be the main agent\'s session.' }) }
      return { ok: true, json: async () => record }
    }))
    resetMainAgentRecordForTest()
    const w = await mountPanel([agent()])

    q('main-agent-link-79189')!.click()
    await flushPromises()

    expect(q('main-agent-error')!.textContent).toContain('on this machine')
    w.unmount()
  })
})
