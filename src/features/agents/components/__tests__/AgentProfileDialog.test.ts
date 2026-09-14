import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentProfileEditor } from '@/composables/useAgentLifecycle'
import { axe } from '@/utils/testA11y'

// 3N.2.2 O15–O24: Edit agent — name and icon, presentation only.

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

let fetchMock: ReturnType<typeof vi.fn>

async function mountDialog() {
  const { default: Dialog } = await import('../AgentProfileDialog.vue')
  const w = mount(Dialog, { attachTo: document.body })
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

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'))
    return { ok: true, json: async () => ({ displayName: body.displayName, category: body.category }) }
  })
  vi.stubGlobal('fetch', fetchMock)
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
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/agents/5919/profile')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ displayName: 'Timer', category: 'document' })
    // The one shared agent state every surface reads (grid, list, workspace, Command).
    expect(applyAgentProfile).toHaveBeenCalledWith('9998d67a-9a9a-4e9e-8197-e5f4b056e733', { displayName: 'Timer', category: 'document' })
    expect(useAgentProfileEditor().editing.value).toBeNull()
    w.unmount()
  })

  it('saves General as no category, and an empty name as the session title', async () => {
    useAgentProfileEditor().requestEdit(agent({ category: 'document' }))
    const w = await mountDialog()
    await chooseIconByKeyboard('General')
    const input = q('agent-profile-name') as HTMLInputElement
    input.value = ''
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(input.getAttribute('placeholder')).toBe('Tell time on request')
    q('agent-profile-save')!.click()
    await flushPromises()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ displayName: '', category: '' })
    w.unmount()
  })

  it('20: shows the server\'s refusal and keeps the dialog open', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({ error: 'unknown agent category "admin"' }) }))
    useAgentProfileEditor().requestEdit(agent())
    const w = await mountDialog()
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
    const input = q('agent-profile-name') as HTMLInputElement
    input.value = 'n'.repeat(61)
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(q('agent-profile-name-too-long')).not.toBeNull()
    expect((q('agent-profile-save') as HTMLButtonElement).disabled).toBe(true)
    w.unmount()
  })

  it('21, 22: touches nothing but the profile route', async () => {
    useAgentProfileEditor().requestEdit(agent({ dashboardOwned: false }))
    const w = await mountDialog()
    q('agent-profile-save')!.click()
    await flushPromises()
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/agents/5919/profile'])
    w.unmount()
  })

  it('24: has no axe violations', async () => {
    useAgentProfileEditor().requestEdit(agent())
    const w = await mountDialog()
    expect(await axe(q('agent-profile-dialog')!.closest('[role="dialog"]') as Element)).toHaveNoViolations()
    w.unmount()
  })
})
