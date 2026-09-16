import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentProfileEditor } from '@/composables/useAgentLifecycle'
import { axe } from '@/utils/testA11y'

/*
 * Edit agent: identity, instructions, permissions, and what the running session
 * is actually doing.
 *
 * Two stores behind one dialog. A name and an icon are presentation and go to
 * the profile route; instructions and a permission mode are configuration, go
 * to the agent's own record, and are offered only where they could ever be
 * applied — an agent this dashboard started. Each is written only when its own
 * part changed, so saving a name cannot rewrite a permission mode.
 */

const applyAgentProfile = vi.fn()
vi.mock('@/features/agents/composables/useAgents', () => ({
  useAgents: () => ({ applyAgentProfile }),
}))

function agent(o: Partial<Agent> = {}) {
  return ({
    pid: 5919,
    sessionId: '9998d67a-9a9a-4e9e-8197-e5f4b056e733',
    provider: 'claude',
    status: 'waiting',
    title: 'Tell time on request',
    displayName: 'Timer',
    ...o,
  }) as Agent
}

interface StubConfig {
  agentId?: string
  displayName?: string
  category?: string
  instructions?: string
  permissionMode?: string
  sessionPermissionMode?: string
  sessionRunning?: boolean
  configurableHere?: boolean
  differsFromSession?: boolean
}

let fetchMock: ReturnType<typeof vi.fn>
let config: StubConfig
let writes: Array<{ url: string, body: Record<string, unknown> }>

function stubFetch() {
  writes = []
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url)
    const method = init?.method ?? 'GET'
    if (href.endsWith('/config') && method === 'GET')
      return { ok: true, json: async () => config }
    const body = JSON.parse(String(init?.body ?? '{}'))
    writes.push({ url: href, body })
    if (href.endsWith('/config'))
      return { ok: true, json: async () => ({ ...config, ...body }) }
    return { ok: true, json: async () => ({ displayName: body.displayName, category: body.category }) }
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function mountDialog() {
  const { default: Dialog } = await import('../AgentProfileDialog.vue')
  const w = mount(Dialog, { attachTo: document.body })
  await flushPromises()
  await flushPromises()
  return w
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

async function key(el: HTMLElement, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  await flushPromises()
}

/** Chooses an icon with the keyboard only: open, arrow to it, Enter. */
async function chooseIconByKeyboard(label: string) {
  const trigger = q('agent-profile-icon') as HTMLButtonElement
  trigger.focus()
  await key(trigger, 'ArrowDown')
  for (let i = 0; i < 10; i++) {
    const active = document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')
    if (active?.textContent?.trim().startsWith(label))
      break
    await key(trigger, 'ArrowDown')
  }
  await key(trigger, 'Enter')
}

async function setText(testid: string, value: string) {
  const el = q(testid) as HTMLInputElement | HTMLTextAreaElement
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

beforeEach(() => {
  config = {
    agentId: 'agent-1',
    instructions: '',
    permissionMode: '',
    sessionPermissionMode: 'default',
    sessionRunning: true,
    configurableHere: true,
    differsFromSession: false,
  }
  stubFetch()
  applyAgentProfile.mockClear()
})
afterEach(() => {
  useAgentProfileEditor().cancelEdit()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('agentProfileDialog', () => {
  it('starts from the agent\'s current name and icon', async () => {
    useAgentProfileEditor().requestEdit(agent({ category: 'research' }))
    const w = await mountDialog()
    expect((q('agent-profile-name') as HTMLInputElement).value).toBe('Timer')
    expect(q('agent-profile-icon')!.textContent).toContain('Research')
    w.unmount()
  })

  it('15, 16, 19, 23: changes General to Documents with the keyboard and applies the saved profile everywhere', async () => {
    useAgentProfileEditor().requestEdit(agent())
    const w = await mountDialog()
    expect(q('agent-profile-icon')!.textContent).toContain('General')
    await chooseIconByKeyboard('Documents')
    expect(q('agent-profile-icon')!.textContent).toContain('Documents')

    q('agent-profile-save')!.click()
    await flushPromises()
    expect(writes).toHaveLength(1)
    expect(writes[0].url).toBe('/api/agents/5919/profile')
    expect(writes[0].body).toEqual({ displayName: 'Timer', category: 'document' })
    // The one shared agent state every surface reads (grid, list, workspace, Command).
    expect(applyAgentProfile).toHaveBeenCalledWith('9998d67a-9a9a-4e9e-8197-e5f4b056e733', { displayName: 'Timer', category: 'document' })
    expect(useAgentProfileEditor().editing.value).toBeNull()
    w.unmount()
  })

  it('saves General as no category, and an empty name as the session title', async () => {
    useAgentProfileEditor().requestEdit(agent({ category: 'document' }))
    const w = await mountDialog()
    await chooseIconByKeyboard('General')
    await setText('agent-profile-name', '')
    expect((q('agent-profile-name') as HTMLInputElement).getAttribute('placeholder')).toBe('Tell time on request')
    q('agent-profile-save')!.click()
    await flushPromises()
    expect(writes[0].body).toEqual({ displayName: '', category: '' })
    w.unmount()
  })

  it('20: shows the server\'s refusal and keeps the dialog open', async () => {
    useAgentProfileEditor().requestEdit(agent())
    const w = await mountDialog()
    fetchMock.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({ error: 'unknown agent category "admin"' }) }))
    await setText('agent-profile-name', 'Renamed')
    q('agent-profile-save')!.click()
    await flushPromises()
    expect(q('agent-profile-error')!.textContent).toContain('unknown agent category')
    expect(applyAgentProfile).not.toHaveBeenCalled()
    expect(q('agent-profile-dialog')).not.toBeNull()
    w.unmount()
  })

  it('refuses an over-long name before saving', async () => {
    useAgentProfileEditor().requestEdit(agent())
    const w = await mountDialog()
    await setText('agent-profile-name', 'n'.repeat(61))
    expect(q('agent-profile-name-too-long')).not.toBeNull()
    expect((q('agent-profile-save') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('24: has no axe violations', async () => {
    useAgentProfileEditor().requestEdit(agent())
    const w = await mountDialog()
    expect(await axe(q('agent-profile-dialog')!.closest('[role="dialog"]') as Element)).toHaveNoViolations()
    w.unmount()
  })
})

describe('agentProfileDialog configuration', () => {
  it('saves instructions and a permission mode to the agent, not the profile', async () => {
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: true }))
    const w = await mountDialog()

    await setText('agent-profile-instructions', 'Only touch the portfolio repository.')
    q('agent-profile-save')!.click()
    await flushPromises()

    expect(writes).toHaveLength(1)
    expect(writes[0].url).toBe('/api/agents/5919/config')
    expect(writes[0].body).toEqual({ instructions: 'Only touch the portfolio repository.', permissionMode: '' })
    w.unmount()
  })

  // Saving a name must not rewrite configuration, and vice versa.
  it('writes only the part that changed', async () => {
    config.instructions = 'keep me'
    config.permissionMode = 'plan'
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: true }))
    const w = await mountDialog()

    await setText('agent-profile-name', 'Renamed')
    q('agent-profile-save')!.click()
    await flushPromises()

    expect(writes.map(x => x.url)).toEqual(['/api/agents/5919/profile'])
    w.unmount()
  })

  /*
   * A session the dashboard did not start can be labelled but not configured:
   * instructions and a mode are applied when the dashboard starts a session, so
   * for an external session there is nothing they could apply to.
   */
  it('offers no configuration for a session the dashboard did not start', async () => {
    config.configurableHere = false
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: false }))
    const w = await mountDialog()

    expect((q('agent-profile-instructions') as HTMLTextAreaElement).disabled).toBe(true)
    expect(q('agent-profile-observe-only')!.textContent).toContain('observed, not configured')

    await setText('agent-profile-name', 'Just a label')
    q('agent-profile-save')!.click()
    await flushPromises()
    expect(writes.map(x => x.url)).toEqual(['/api/agents/5919/profile'])
    w.unmount()
  })

  it('says what the running session uses and what the next one will', async () => {
    config.permissionMode = 'acceptEdits'
    config.sessionPermissionMode = 'default'
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: true }))
    const w = await mountDialog()

    expect(q('agent-profile-session-note')!.textContent).toContain('Current session')
    expect(q('agent-profile-session-differs')!.textContent).toContain('until you resume or restart')
    w.unmount()
  })

  it('says nothing about a difference when none exists', async () => {
    config.permissionMode = 'default'
    config.sessionPermissionMode = 'default'
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: true }))
    const w = await mountDialog()
    expect(q('agent-profile-session-differs')).toBeNull()
    w.unmount()
  })

  it('warns about a mode that stops asking, without changing the running session', async () => {
    config.permissionMode = 'bypassPermissions'
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: true }))
    const w = await mountDialog()
    expect(q('agent-profile-dangerous')!.textContent).toContain('without asking')
    expect(q('agent-profile-dangerous')!.textContent).toContain('changes nothing about the session running now')
    w.unmount()
  })

  // The role is seeded on the server; no agent can be promoted from a dialog.
  it('offers no way to designate a main agent', async () => {
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: true, displayName: 'Project Intelligence' }))
    const w = await mountDialog()
    expect(q('agent-profile-main')).toBeNull()
    expect(document.body.textContent).not.toContain('Main agent —')
    w.unmount()
  })

  it('does not show a session line as though a finished agent were running', async () => {
    config.sessionRunning = false
    useAgentProfileEditor().requestEdit(agent({ status: 'finished', dashboardOwned: true }))
    const w = await mountDialog()
    expect(q('agent-profile-session-note')!.textContent).toContain('No session is running')
    w.unmount()
  })
})
