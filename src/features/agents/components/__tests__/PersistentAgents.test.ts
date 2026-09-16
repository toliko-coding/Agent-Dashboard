import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPersistentAgentsForTest } from '@/features/agents/composables/usePersistentAgents'
import { axe } from '@/utils/testA11y'
import PersistentAgents from '../PersistentAgents.vue'

/*
 * An agent belongs to this dashboard until someone deletes it.
 *
 * The roster is live processes plus an in-process registry of recently-finished
 * ones, so restarting the server used to empty the Agents page of every
 * finished agent - a Resume Editor and a Portfolio Developer disappeared that
 * way, with nothing deleted and no way to tell from the page that they still
 * existed. These tests pin the durable half: what storage holds is listed even
 * when the roster knows nothing at all.
 */

// In the order the server returns: the main agent first, then by display name.
const STORED = [
  { agentId: 'a-main', displayName: 'Agent Dashboard Manager', category: 'development', permissionMode: '', hasInstructions: false, cwd: '/repo/agent-dashboard', role: 'main', sessionId: 'sess-manager', resumable: true },
  // Portfolio Developer still has its transcript; Resume Editor's is gone, so
  // one is resumed and the other started - the difference the row must show.
  { agentId: 'a-portfolio', displayName: 'Portfolio Developer', category: 'web', permissionMode: '', hasInstructions: false, cwd: '/Users/me/GitHub/Protfolio', role: '', sessionId: 'sess-portfolio', resumable: true },
  { agentId: 'a-resume', displayName: 'Resume Editor', category: 'document', permissionMode: 'acceptEdits', hasInstructions: true, cwd: '/Users/me/AI-Agents/Resume-Editor', role: '', sessionId: 'sess-resume', resumable: false },
]

function agent(o: Partial<Agent> = {}) {
  return ({ pid: 29194, sessionId: 'sess-portfolio', provider: 'claude', status: 'active', cwd: '/Users/me/GitHub/Protfolio', ...o }) as Agent
}

let stored: unknown[]
let deletes: string[]

function stubFetch(deleteFails = false) {
  deletes = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      deletes.push(String(url))
      return deleteFails
        ? { ok: false, status: 403, json: async () => ({ error: 'This is the main agent, which maintains Agent Dashboard. It cannot be deleted.' }) }
        : { ok: true, json: async () => ({ deleted: true }) }
    }
    return { ok: true, json: async () => stored }
  }))
}

async function mountSection(agents: Agent[] = []) {
  const w = mount(PersistentAgents, { props: { agents }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return w
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const all = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[]

beforeEach(() => {
  stored = [...STORED]
  resetPersistentAgentsForTest()
  stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  resetPersistentAgentsForTest()
})

describe('agents kept with no session running', () => {
  /*
   * The restart case that lost two real agents: nothing is running, nothing has
   * been deleted, and the page must still show that they exist.
   */
  it('lists a stored agent when the roster knows nothing at all', async () => {
    const w = await mountSection([])

    expect(all('persistent-agent-name').map(e => e.textContent?.trim())).toEqual(['Portfolio Developer', 'Resume Editor'])
    expect(q('persistent-agents-count')!.textContent).toContain('2 kept')
    w.unmount()
  })

  // The main agent has its own panel; listing it here would show it twice.
  it('leaves the main agent to its own panel', async () => {
    const w = await mountSection([])
    expect(document.body.textContent).not.toContain('Agent Dashboard Manager')
    w.unmount()
  })

  // An agent with a session in the roster already has a card of its own.
  it('does not repeat an agent whose session the roster has', async () => {
    const w = await mountSection([agent()])

    const names = all('persistent-agent-name').map(e => e.textContent?.trim())
    expect(names).toEqual(['Resume Editor'])
    w.unmount()
  })

  it('shows what the next session would start with, and nothing it has not saved', async () => {
    const w = await mountSection([])

    const resume = all('persistent-agent').find(el => el.textContent?.includes('Resume Editor'))!
    expect(resume.textContent).toContain('Resume-Editor')
    expect(resume.textContent).toContain('next session')
    expect(resume.textContent).toContain('has instructions')

    const portfolio = all('persistent-agent').find(el => el.textContent?.includes('Portfolio Developer'))!
    expect(portfolio.textContent).not.toContain('next session')
    expect(portfolio.textContent).not.toContain('has instructions')
    w.unmount()
  })

  /*
   * Deleting is the dashboard forgetting an agent. It is said plainly, because
   * the folder it names is the user's own work.
   */
  it('removes the agent from the list and says what delete does not touch', async () => {
    const w = await mountSection([])

    expect(q('persistent-agents-note')!.textContent).toContain('repository')
    q('persistent-agent-delete-a-resume')!.click()
    await flushPromises()

    expect(deletes).toEqual(['/api/dashboard-agents/a-resume'])
    expect(all('persistent-agent-name').map(e => e.textContent?.trim())).toEqual(['Portfolio Developer'])
    w.unmount()
  })

  it('shows a refusal rather than dropping the agent from the list', async () => {
    stubFetch(true)
    const w = await mountSection([])

    q('persistent-agent-delete-a-resume')!.click()
    await flushPromises()

    expect(q('persistent-agents-error')!.textContent).toContain('cannot be deleted')
    expect(all('persistent-agent-name')).toHaveLength(2)
    w.unmount()
  })

  // Unknown stays unknown: a failed read must not claim this dashboard keeps none.
  it('renders nothing rather than an empty list when the list cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) })))
    resetPersistentAgentsForTest()
    const w = await mountSection([])

    expect(q('persistent-agents')).toBeNull()
    w.unmount()
  })

  it('has no axe violations', async () => {
    const w = await mountSection([])
    expect(await axe(q('persistent-agents')!)).toHaveNoViolations()
    w.unmount()
  })

  /*
   * An agent with no session was previously a row with nothing to click: it
   * could be seen and deleted, and not opened, started or inspected.
   */
  it('gives every kept agent something to do', async () => {
    const w = await mountSection([])

    expect(q('persistent-agent-open-a-resume')).not.toBeNull()
    expect(q('persistent-agent-start-a-resume')).not.toBeNull()
    expect(q('persistent-agent-delete-a-resume')).not.toBeNull()
    expect(q('persistent-agent-state')!.textContent).toContain('No session running')
    w.unmount()
  })

  // Resume continues a conversation and Start begins one, so the row says which
  // it will be - taken from whether the transcript is still on disk.
  it('says whether it would resume the conversation or start a new one', async () => {
    const w = await mountSection([])

    expect(q('persistent-agent-start-a-portfolio')!.textContent).toContain('Resume agent')
    expect(q('persistent-agent-start-a-resume')!.textContent).toContain('Start agent')
    w.unmount()
  })

  it('opens the agent rather than acting on it immediately', async () => {
    const w = await mountSection([])

    q('persistent-agent-open-a-resume')!.click()
    await flushPromises()
    await flushPromises()

    expect(q('persistent-agent-dialog')).not.toBeNull()
    w.unmount()
  })
})
