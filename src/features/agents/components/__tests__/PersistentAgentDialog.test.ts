import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetPersistentAgentsForTest } from '@/features/agents/composables/usePersistentAgents'
import { axe } from '@/utils/testA11y'
import PersistentAgentDialog from '../PersistentAgentDialog.vue'

/*
 * An agent with no session running, opened.
 *
 * Starting and resuming are different acts and are never presented as one. The
 * choice comes from what is on disk: with the transcript still there the next
 * session continues the conversation; without it a new one begins, and the
 * dialog says so rather than promising a continuation it cannot deliver.
 *
 * Whichever happens, the agent keeps its identity - the session is attached to
 * this same record instead of a second agent being created for it.
 */

const RESUMABLE = {
  agentId: 'a-portfolio',
  displayName: 'Portfolio Developer',
  category: 'web',
  cwd: '/Users/me/GitHub/Protfolio',
  projectId: '',
  instructions: 'Keep to the portfolio repository.',
  permissionMode: 'acceptEdits',
  role: '',
  sessionId: 'sess-portfolio',
  resumable: true,
}

let config: Record<string, unknown>
let posts: Array<{ url: string, method: string, body: Record<string, unknown> }>

function stubFetch(spawnFails = false) {
  posts = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url)
    const method = init?.method ?? 'GET'
    if (method === 'GET')
      return { ok: true, json: async () => config }
    posts.push({ url: href, method, body: JSON.parse(String(init?.body ?? '{}')) })
    if (href.includes('/api/agents/spawn')) {
      return spawnFails
        ? { ok: false, status: 400, json: async () => ({ error: 'missing or invalid prompt' }) }
        : { ok: true, json: async () => ({ pid: 4242 }) }
    }
    if (method === 'DELETE')
      return { ok: true, json: async () => ({ deleted: true }) }
    return { ok: true, json: async () => config }
  }))
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

/** The testid may sit on a field wrapper, so reach the control inside it. */
function field(id: string): HTMLTextAreaElement | HTMLInputElement {
  const el = q(id)!
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'INPUT')
    return el as HTMLTextAreaElement
  return el.querySelector('textarea, input') as HTMLTextAreaElement
}

async function type(id: string, value: string) {
  const el = field(id)
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function open(over: Record<string, unknown> = {}) {
  config = { ...RESUMABLE, ...over }
  const w = mount(PersistentAgentDialog, { props: { agentId: String(config.agentId) }, attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return w
}

beforeEach(() => {
  resetPersistentAgentsForTest()
  stubFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  resetPersistentAgentsForTest()
})

describe('opening an agent that has no session', () => {
  it('shows what the agent is, not what a process is doing', async () => {
    const w = await open()

    expect(q('persistent-agent-status')!.textContent).toContain('No session running')
    expect(q('persistent-agent-folder-path')!.textContent).toContain('/Users/me/GitHub/Protfolio')
    expect(field('persistent-agent-instructions').value).toBe('Keep to the portfolio repository.')
    expect(q('persistent-agent-dialog')).not.toBeNull()
    w.unmount()
  })

  it('offers to resume when the conversation can still be reopened', async () => {
    const w = await open()

    expect(q('persistent-agent-start')!.textContent).toContain('Resume agent')
    expect(q('persistent-agent-start-note')!.textContent).toContain('Continues the conversation')
    w.unmount()
  })

  // A pruned transcript is not a conversation. The dialog says a new one starts.
  it('offers to start when the transcript is gone', async () => {
    const w = await open({ resumable: false })

    expect(q('persistent-agent-start')!.textContent).toContain('Start agent')
    expect(q('persistent-agent-start-note')!.textContent).toContain('no longer on disk')
    w.unmount()
  })

  it('says an agent that never ran a session is starting a new conversation', async () => {
    const w = await open({ resumable: false, sessionId: '' })

    expect(q('persistent-agent-start-note')!.textContent).toContain('has not run a session yet')
    w.unmount()
  })

  /*
   * A session starts with a message. The server refuses a spawn without one, so
   * the button waits for it rather than sending a request that can only fail.
   */
  it('will not start a session with nothing to do', async () => {
    const w = await open()

    expect((q('persistent-agent-start') as HTMLButtonElement).disabled).toBe(true)
    await type('persistent-agent-first-message', 'Continue the portfolio work.')
    expect((q('persistent-agent-start') as HTMLButtonElement).disabled).toBe(false)
    w.unmount()
  })

  /*
   * The crux: starting an agent that already exists must not create a second
   * one. `agentId` is what the server points at the new session.
   */
  it('resumes the same agent, carrying its identity and its session', async () => {
    const w = await open()
    await type('persistent-agent-first-message', 'Continue the portfolio work.')

    q('persistent-agent-start')!.click()
    await flushPromises()

    const spawn = posts.find(p => p.url.includes('/api/agents/spawn'))!
    expect(spawn.body.agentId).toBe('a-portfolio')
    expect(spawn.body.resumeSessionId).toBe('sess-portfolio')
    expect(spawn.body.prompt).toBe('Continue the portfolio work.')
    expect(spawn.body.cwd).toBe('/Users/me/GitHub/Protfolio')
    expect(spawn.body.permissionMode).toBe('acceptEdits')
    expect(w.emitted('started')?.[0]).toEqual([4242])
    w.unmount()
  })

  // Without a transcript there is nothing to resume, so no session is named.
  it('starts a new session without claiming to continue one', async () => {
    const w = await open({ resumable: false })
    await type('persistent-agent-first-message', 'Start fresh.')

    q('persistent-agent-start')!.click()
    await flushPromises()

    const spawn = posts.find(p => p.url.includes('/api/agents/spawn'))!
    expect(spawn.body.agentId).toBe('a-portfolio')
    expect(spawn.body.resumeSessionId).toBeUndefined()
    w.unmount()
  })

  it('saves an edited mode and instructions before the session starts with them', async () => {
    const w = await open()
    await type('persistent-agent-instructions', 'Only the tailored folder.')
    await type('persistent-agent-first-message', 'Go on.')

    q('persistent-agent-start')!.click()
    await flushPromises()

    const saved = posts.find(p => p.method === 'PUT')!
    expect(saved.url).toBe('/api/dashboard-agents/a-portfolio')
    expect(saved.body.instructions).toBe('Only the tailored folder.')
    w.unmount()
  })

  it('shows the server’s refusal rather than reporting a session that never started', async () => {
    stubFetch(true)
    const w = await open()
    await type('persistent-agent-first-message', 'Go on.')

    q('persistent-agent-start')!.click()
    await flushPromises()

    expect(q('persistent-agent-error')!.textContent).toContain('missing or invalid prompt')
    expect(w.emitted('started')).toBeUndefined()
    w.unmount()
  })

  it('deletes the agent explicitly, from the agent itself', async () => {
    const w = await open()

    q('persistent-agent-delete')!.click()
    await flushPromises()

    expect(posts.find(p => p.method === 'DELETE')!.url).toBe('/api/dashboard-agents/a-portfolio')
    expect(w.emitted('deleted')?.[0]).toEqual(['a-portfolio'])
    w.unmount()
  })

  it('has no axe violations', async () => {
    const w = await open()
    expect(await axe(q('persistent-agent-dialog')!)).toHaveNoViolations()
    w.unmount()
  })
})
