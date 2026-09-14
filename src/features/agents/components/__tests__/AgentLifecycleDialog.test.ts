import type { Agent } from '@/types'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAgentLifecycle } from '@/composables/useAgentLifecycle'

// 3N.2: the one confirmation for stopping or deleting an agent.

const selectedAgent = ref<Agent | null>(null)
const selectAgent = vi.fn((a: Agent | null) => {
  selectedAgent.value = a
})
const dismissAgent = vi.fn()
vi.mock('@/features/agents/composables/useAgents', () => ({
  useAgents: () => ({ selectedAgent, selectAgent, dismissAgent }),
}))

const agent = (o: Partial<Agent> = {}) => ({ pid: 77, sessionId: 's-77', provider: 'claude', status: 'active', displayName: 'Portfolio', category: 'web', ...o }) as Agent

let fetchMock: ReturnType<typeof vi.fn>

async function mountDialog() {
  const { default: Dialog } = await import('../AgentLifecycleDialog.vue')
  const w = mount(Dialog, { attachTo: document.body })
  await flushPromises()
  return w
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ deleted: true, stopped: true }) }))
  vi.stubGlobal('fetch', fetchMock)
  selectAgent.mockClear()
  dismissAgent.mockClear()
})
afterEach(() => {
  useAgentLifecycle().cancel()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('agentLifecycleDialog — delete', () => {
  it('says the agent leaves the dashboard while its files, repository and history stay, and that a running agent is stopped first', async () => {
    const w = await mountDialog()
    useAgentLifecycle().requestDelete(agent())
    await flushPromises()
    expect(q('agent-lifecycle-dialog')!.textContent).toContain('Delete “Portfolio”?')
    const text = q('agent-lifecycle-explanation')!.textContent!
    expect(text).toContain('This removes the agent from Agent Dashboard.')
    expect(text).toContain('Your project files and Git repository will not be deleted')
    expect(q('agent-lifecycle-stops')!.textContent).toContain('stopped first')
    expect(fetchMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('deletes a running agent only with its stop confirmed, then drops it from view and closes its details', async () => {
    selectedAgent.value = agent()
    const w = await mountDialog()
    useAgentLifecycle().requestDelete(agent())
    await flushPromises()
    q('agent-lifecycle-confirm')!.click()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/77?stop=true', expect.objectContaining({ method: 'DELETE' }))
    expect(dismissAgent).toHaveBeenCalledWith(77)
    expect(selectAgent).toHaveBeenCalledWith(null)
    expect(useAgentLifecycle().pending.value).toBeNull()
    w.unmount()
  })

  it('does not ask to stop a finished agent', async () => {
    const w = await mountDialog()
    useAgentLifecycle().requestDelete(agent({ status: 'finished' }))
    await flushPromises()
    expect(q('agent-lifecycle-stops')).toBeNull()
    q('agent-lifecycle-confirm')!.click()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/77', expect.objectContaining({ method: 'DELETE' }))
    w.unmount()
  })

  it('keeps the dialog open with the server\'s reason when deleting fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'agent is running; confirm stopping it to delete it' }) })
    const w = await mountDialog()
    useAgentLifecycle().requestDelete(agent({ status: 'finished' }))
    await flushPromises()
    q('agent-lifecycle-confirm')!.click()
    await flushPromises()
    expect(q('agent-lifecycle-error')!.textContent).toContain('agent is running')
    expect(dismissAgent).not.toHaveBeenCalled()
    expect(useAgentLifecycle().pending.value).not.toBeNull()
    w.unmount()
  })

  it('cancels with a real, focusable button and changes nothing', async () => {
    const w = await mountDialog()
    useAgentLifecycle().requestDelete(agent())
    await flushPromises()
    const cancel = q('agent-lifecycle-cancel') as HTMLButtonElement
    expect(cancel.tagName).toBe('BUTTON')
    cancel.focus()
    expect(document.activeElement).toBe(cancel)
    cancel.click()
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useAgentLifecycle().pending.value).toBeNull()
    w.unmount()
  })
})

describe('agentLifecycleDialog — stop', () => {
  it('stops without deleting anything', async () => {
    const w = await mountDialog()
    useAgentLifecycle().requestStop(agent())
    await flushPromises()
    expect(q('agent-lifecycle-dialog')!.textContent).toContain('Stop “Portfolio”?')
    q('agent-lifecycle-confirm')!.click()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/77/stop', expect.objectContaining({ method: 'POST' }))
    expect(dismissAgent).not.toHaveBeenCalled()
    w.unmount()
  })
})

// 3N.2.1: inside a dialog a <header> is a second page banner landmark (axe).
describe('agentLifecycleDialog — landmarks', () => {
  it('adds no banner landmark inside the dialog, and the shared modal header neither', async () => {
    useAgentLifecycle().requestDelete(agent({ dashboardOwned: true }))
    const w = await mountDialog()
    expect(q('agent-lifecycle-dialog')).not.toBeNull()
    expect(document.querySelector('[data-testid="agent-lifecycle-dialog"] header')).toBeNull()
    const { default: AppModalHeader } = await import('@/components/ui/AppModalHeader.vue')
    const header = mount(AppModalHeader, { props: { title: 'New Agent', id: 'spawn-title' } })
    expect(header.find('header').exists()).toBe(false)
    expect(header.get('h2').attributes('id')).toBe('spawn-title')
    header.unmount()
    w.unmount()
  })
})

// 3N.2.2: resuming a legacy session under Dashboard control is explicit and says what it does.
describe('agentLifecycleDialog — resume under Dashboard', () => {
  it('explains the /exit, asks for confirmation and calls only the resume route', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ ok: true, pid: 88, previousPid: 77, endedRunningSession: true }) }))
    useAgentLifecycle().requestResume(agent({ displayName: 'Timer', liveInjectable: true }), { available: true, endsRunningSession: true })
    const w = await mountDialog()
    expect(q('agent-lifecycle-dialog')!.textContent).toContain('Resume “Timer” under Agent Dashboard?')
    expect(q('agent-lifecycle-explanation')!.textContent).toContain('/exit')
    expect(q('agent-lifecycle-interrupts')).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(q('agent-lifecycle-confirm')!.textContent).toContain('Resume under Dashboard')
    q('agent-lifecycle-confirm')!.click()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/agents/77/resume-under-dashboard')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(dismissAgent).toHaveBeenCalledWith(77)
    w.unmount()
  })

  it('for a finished session, says nothing is interrupted', async () => {
    useAgentLifecycle().requestResume(agent({ status: 'finished' }), { available: true, endsRunningSession: false })
    const w = await mountDialog()
    expect(q('agent-lifecycle-explanation')!.textContent).not.toContain('/exit')
    expect(q('agent-lifecycle-interrupts')).toBeNull()
    w.unmount()
  })
})
