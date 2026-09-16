import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentLifecycle } from '@/composables/useAgentLifecycle'

/*
 * Resuming an agent shows what the new session will start with, before it
 * starts.
 *
 * Claude reads its permission mode and system prompt once, at startup, so this
 * dialog is the only moment the configuration can be reviewed. What it displays
 * is sent back with the confirmation, so a configuration changed in another tab
 * is caught by the server instead of quietly launching something nobody saw.
 */

const dismissAgent = vi.fn()
const selectAgent = vi.fn()
vi.mock('@/features/agents/composables/useAgents', () => ({
  useAgents: () => ({
    selectedAgent: { value: null },
    selectAgent,
    dismissAgent,
    selectAgentWhenAvailable: vi.fn(),
  }),
}))

function agent(o: Partial<Agent> = {}) {
  return ({
    pid: 5919,
    sessionId: '9998d67a-9a9a-4e9e-8197-e5f4b056e733',
    provider: 'claude',
    status: 'finished',
    title: 'Portfolio work',
    displayName: 'Portfolio Developer',
    projectName: 'Protfolio',
    ...o,
  }) as Agent
}

let fetchMock: ReturnType<typeof vi.fn>
let config: Record<string, unknown>
let posts: Array<{ url: string, body: Record<string, unknown> }>

function stubFetch() {
  posts = []
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url)
    if (href.endsWith('/config'))
      return { ok: true, json: async () => config }
    posts.push({ url: href, body: JSON.parse(String(init?.body ?? '{}')) })
    return { ok: true, json: async () => ({ pid: 9001, previousPid: 5919, endedRunningSession: false }) }
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function openResume(over: Partial<Agent> = {}) {
  const { default: Dialog } = await import('../AgentLifecycleDialog.vue')
  const w = mount(Dialog, { attachTo: document.body })
  useAgentLifecycle().requestResume(agent(over), { available: true, endsRunningSession: false, reason: '' } as never)
  await flushPromises()
  await flushPromises()
  return w
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

beforeEach(() => {
  config = {
    agentId: 'agent-1',
    instructions: 'Only touch the portfolio repository.',
    permissionMode: 'acceptEdits',
    sessionPermissionMode: '',
    sessionRunning: false,
    configurableHere: true,
  }
  stubFetch()
  dismissAgent.mockClear()
})
afterEach(() => {
  useAgentLifecycle().cancel()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('resume confirmation', () => {
  it('shows the agent, its workspace, the permission mode and the instructions', async () => {
    const w = await openResume()

    expect(q('agent-lifecycle-resume-agent')!.textContent).toContain('Portfolio Developer')
    expect(q('agent-lifecycle-resume-workspace')!.textContent).toContain('Protfolio')
    expect(q('agent-lifecycle-resume-mode')!.textContent).toContain('Auto-accepts edits')
    // The text itself is behind a disclosure, not dumped into the dialog.
    expect(q('agent-lifecycle-resume-instructions')).toBeNull()
    q('agent-lifecycle-resume-instructions-toggle')!.click()
    await flushPromises()
    expect(q('agent-lifecycle-resume-instructions')!.textContent).toContain('Only touch the portfolio repository.')
    w.unmount()
  })

  it('sends back what it displayed, so the server can check it is still current', async () => {
    const w = await openResume()

    q('agent-lifecycle-confirm')!.click()
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe('/api/agents/5919/resume-under-dashboard')
    expect(posts[0].body.confirmed).toBe(true)
    expect(posts[0].body.permissionMode).toBe('acceptEdits')
    w.unmount()
  })

  it('starts nothing when the dialog is cancelled', async () => {
    const w = await openResume()

    q('agent-lifecycle-cancel')!.click()
    await flushPromises()

    expect(posts).toHaveLength(0)
    expect(useAgentLifecycle().pending.value).toBeNull()
    w.unmount()
  })

  it('says so when an agent has no saved instructions', async () => {
    config.instructions = ''
    const w = await openResume()
    expect(q('agent-lifecycle-resume-no-instructions')!.textContent).toContain('None saved')
    expect(q('agent-lifecycle-resume-instructions-toggle')).toBeNull()
    w.unmount()
  })

  it('names Claude’s default when nothing is saved, and confirms that', async () => {
    config.permissionMode = ''
    const w = await openResume()
    expect(q('agent-lifecycle-resume-mode')!.textContent).toContain('Asks permission')

    q('agent-lifecycle-confirm')!.click()
    await flushPromises()
    expect(posts[0].body.permissionMode).toBe('default')
    w.unmount()
  })

  // A mode that stops asking is called out before the session starts, not after.
  it('warns when the saved mode acts without asking', async () => {
    config.permissionMode = 'bypassPermissions'
    const w = await openResume()
    expect(q('agent-lifecycle-resume-dangerous')!.textContent).toContain('without asking')
    w.unmount()
  })

  /*
   * If the configuration cannot be read, nothing is confirmed. The server then
   * applies nothing and starts the session on Claude's default — the
   * non-escalating direction, chosen deliberately over guessing.
   */
  it('confirms nothing when the configuration could not be read', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/config'))
        return { ok: false, status: 503, json: async () => ({ error: 'unavailable' }) }
      posts.push({ url: href, body: JSON.parse(String(init?.body ?? '{}')) })
      return { ok: true, json: async () => ({ pid: 9001, previousPid: 5919, endedRunningSession: false }) }
    })
    const w = await openResume()

    q('agent-lifecycle-confirm')!.click()
    await flushPromises()

    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({})
    w.unmount()
  })
})
