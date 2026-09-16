import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
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
let spawns: Array<Record<string, unknown>>

function stubFetch() {
  posts = []
  spawns = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}'))
      if (String(url).includes('/api/agents/spawn')) {
        spawns.push(body)
        return { ok: true, json: async () => ({ pid: 4242 }) }
      }
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

  it('has no axe violations, with a session and without one', async () => {
    const empty = await mountPanel([])
    expect(await axe(q('main-agent-panel')!)).toHaveNoViolations()
    empty.unmount()

    record = { ...MAIN, sessionId: 'sess-manager' }
    resetMainAgentRecordForTest()
    const linked = await mountPanel([agent()])
    expect(await axe(q('main-agent-panel')!)).toHaveNoViolations()
    linked.unmount()
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

  /*
   * The Manager running in the user's editor is observed, not owned. The panel
   * says which it is, because the difference decides what may be done to it.
   */
  it('says when the session runs outside the dashboard, and offers to observe it', async () => {
    record = { ...MAIN, sessionId: 'sess-manager' }
    const w = await mountPanel([agent()])

    expect(q('main-agent-external')!.textContent).toContain('outside Agent Dashboard')
    expect(q('main-agent-external')!.textContent).toContain('a second main agent')
    expect(q('main-agent-open')!.textContent).toContain('Observe session')
    w.unmount()
  })

  it('opens, rather than observes, a session this dashboard started', async () => {
    record = { ...MAIN, sessionId: 'sess-manager' }
    const w = await mountPanel([agent({ dashboardOwned: true })])

    expect(q('main-agent-external')).toBeNull()
    expect(q('main-agent-open')!.textContent).toContain('Open session')
    w.unmount()
  })

  // Starting is never offered beside a running session: that is the one way a
  // second main agent could be produced from this page.
  it('offers no start while a session is running it', async () => {
    record = { ...MAIN, sessionId: 'sess-manager' }
    const w = await mountPanel([agent()])
    expect(q('main-agent-start')).toBeNull()
    w.unmount()
  })

  it('starts nothing until the user confirms what will be started', async () => {
    record = { ...MAIN, cwd: '/repo/agent-dashboard', permissionMode: 'acceptEdits', instructions: 'Maintain the dashboard.' }
    const w = await mountPanel([])

    q('main-agent-start-button')!.click()
    await flushPromises()
    expect(spawns).toHaveLength(0)
    expect(q('main-agent-start-folder')!.textContent).toContain('/repo/agent-dashboard')
    expect(q('main-agent-start-mode')!.textContent).toContain('auto-accepts edits')
    expect(q('main-agent-start-instructions')!.textContent).toContain('saved instructions are applied')

    q('main-agent-start-confirm-button')!.click()
    await flushPromises()
    expect(spawns).toEqual([{
      cwd: '/repo/agent-dashboard',
      enableChannel: true,
      permissionMode: 'acceptEdits',
      systemPrompt: 'Maintain the dashboard.',
    }])
    w.unmount()
  })

  // Nothing is invented: an agent with no saved mode starts on Claude's own
  // default, and the confirmation says exactly that.
  it('promises no configuration the agent has not saved', async () => {
    record = { ...MAIN, sessionId: 'sess-old', cwd: '/repo/agent-dashboard' }
    const w = await mountPanel([])

    q('main-agent-start-button')!.click()
    await flushPromises()
    expect(q('main-agent-start-instructions')!.textContent).toContain('no saved instructions')

    q('main-agent-start-confirm-button')!.click()
    await flushPromises()
    expect(spawns).toEqual([{ cwd: '/repo/agent-dashboard', enableChannel: true, resumeSessionId: 'sess-old' }])
    w.unmount()
  })

  it('cancelling the start leaves nothing started', async () => {
    const w = await mountPanel([])
    q('main-agent-start-button')!.click()
    await flushPromises()
    q('main-agent-start-cancel')!.click()
    await flushPromises()

    expect(spawns).toHaveLength(0)
    expect(q('main-agent-start-confirm')).toBeNull()
    w.unmount()
  })

  it('shows the server refusing a second main agent', async () => {
    const w = await mountPanel([])
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && String(url).includes('/api/agents/spawn'))
        return { ok: false, status: 409, json: async () => ({ error: 'the main agent is already running in another process', main: true }) }
      return { ok: true, json: async () => record }
    }))
    q('main-agent-start-button')!.click()
    await flushPromises()
    q('main-agent-start-confirm-button')!.click()
    await flushPromises()

    expect(q('main-agent-error')!.textContent).toContain('already running in another process')
    w.unmount()
  })

  it('has no axe violations while confirming a start', async () => {
    const w = await mountPanel([])
    q('main-agent-start-button')!.click()
    await flushPromises()
    expect(await axe(q('main-agent-panel')!)).toHaveNoViolations()
    w.unmount()
  })
})
