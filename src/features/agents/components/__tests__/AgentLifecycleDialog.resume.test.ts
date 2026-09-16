import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentLifecycle } from '@/composables/useAgentLifecycle'
import { axe } from '@/utils/testA11y'

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

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

/*
 * Waits for a condition instead of a fixed number of flushes.
 *
 * The configuration is fetched when the dialog opens, and how many microtask
 * turns that takes depends on machine load - these tests passed alone and failed
 * beside the rest of the suite, which is a test bug, not a product one.
 */
async function settle(done: () => boolean, tries = 60) {
  for (let i = 0; i < tries; i++) {
    await flushPromises()
    if (done())
      return
  }
}

async function openResume(over: Partial<Agent> = {}, waitForConfig = true) {
  const { default: Dialog } = await import('../AgentLifecycleDialog.vue')
  const w = mount(Dialog, { attachTo: document.body })
  useAgentLifecycle().requestResume(agent(over), { available: true, endsRunningSession: false, reason: '' } as never)
  await settle(() => !!q('agent-lifecycle-dialog'))
  if (waitForConfig)
    await settle(() => !!q('agent-lifecycle-resume-config'))
  return w
}

beforeEach(() => {
  /*
   * `pending` is module-level shared state and the dialog is mounted fresh per
   * test, so a resume left over from the previous one greets the new mount and
   * its in-flight config fetch resolves against it. That is what made failures
   * wander between tests in this file, vanish under --no-file-parallelism, and
   * never touch another file. Clearing it up front, not only afterwards, is the
   * isolation the shared setup already applies to mounted components.
   */
  useAgentLifecycle().cancel()
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
    await settle(() => !!q('agent-lifecycle-resume-instructions'))
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

  /*
   * Confirming is held until the configuration is read.
   *
   * Found live: the dialog renders before the fetch resolves, so for a moment
   * it shows Claude's default with no instructions. Clicking Confirm then sends
   * no confirmation at all, and the session starts on the default while the
   * agent's saved mode goes unused - the user confirms something never shown.
   */
  it('will not let you confirm before the configuration has been read', async () => {
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/config')) {
        await held
        return { ok: true, json: async () => config }
      }
      posts.push({ url: href, body: JSON.parse(String(init?.body ?? '{}')) })
      return { ok: true, json: async () => ({ pid: 9001, previousPid: 5919, endedRunningSession: false }) }
    })
    const w = await openResume({}, false)

    expect((q('agent-lifecycle-confirm') as HTMLButtonElement).disabled).toBe(true)
    expect(q('agent-lifecycle-resume-loading')).not.toBeNull()
    expect(q('agent-lifecycle-resume-config')).toBeNull()

    release()
    await settle(() => !(q('agent-lifecycle-confirm') as HTMLButtonElement | null)?.disabled)

    expect((q('agent-lifecycle-confirm') as HTMLButtonElement).disabled).toBe(false)
    expect(q('agent-lifecycle-resume-mode')!.textContent).toContain('Auto-accepts edits')
    q('agent-lifecycle-confirm')!.click()
    await settle(() => posts.length > 0)
    expect(posts[0].body.permissionMode).toBe('acceptEdits')
    w.unmount()
  })

  it('has no axe violations, including with the instructions expanded', async () => {
    const w = await openResume()
    await settle(() => !!q('agent-lifecycle-dialog'))
    expect(q('agent-lifecycle-dialog')).not.toBeNull()
    expect(await axe(q('agent-lifecycle-dialog')!)).toHaveNoViolations()
    q('agent-lifecycle-resume-instructions-toggle')!.click()
    await settle(() => !!q('agent-lifecycle-resume-instructions'))
    expect(await axe(q('agent-lifecycle-dialog')!)).toHaveNoViolations()
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
