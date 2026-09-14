import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SpotlightSearch from './SpotlightSearch.vue'

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ tasks: [], agents: [] }),
})

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('spotlightSearch', () => {
  it('is hidden by default', () => {
    mount(SpotlightSearch)
    expect(document.querySelector('input[placeholder]')).toBeNull()
  })

  it('opens on Cmd+K', async () => {
    const wrapper = mount(SpotlightSearch, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('input[placeholder]')).not.toBeNull()
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mount(SpotlightSearch, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('input[placeholder]')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('input[placeholder]')).toBeNull()
    wrapper.unmount()
  })

  it('emits navigateTask on Enter when task selected', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [{ id: 't1', title: 'Test Task', currentStage: 'implementation', slug: 'test-task', description: null, cwd: '/', worktreePath: null, sourceBranch: null, targetBranch: null, parentTaskId: null, maxIterations: 3, tokenBudget: null, costBudgetCents: null, stageTimeoutSeconds: 1800, createdAt: '', updatedAt: '', metadata: null, silverBullet: false, priority: 'medium', userId: null }],
        agents: [],
      }),
    })
    const wrapper = mount(SpotlightSearch, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await wrapper.vm.$nextTick()
    // The input lives inside a Teleport; set the reactive query directly on the vm
    const vm = wrapper.vm as unknown as { query: string }
    vm.query = 'test'
    await new Promise(resolve => setTimeout(resolve, 300))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('navigateTask')).toBeTruthy()
    wrapper.unmount()
  })
})

describe('spotlightSearch — result labels (3L)', () => {
  const agent = {
    pid: 4242,
    sessionId: 'abcdef0123456789',
    provider: 'claude',
    projectName: 'secret-folder',
    projectPath: '/Users/x/secret-folder',
    cwd: '/Users/x/secret-folder',
    status: 'active',
    working: true,
    workspace: { id: 'ws1', name: 'app-wt', kind: 'git-worktree', branch: 'feat/x', repository: { id: 'r1', name: 'app' } },
  }
  const task = { id: 't1', title: 'Build it', currentStage: 'implementation', slug: 'build-it', cwd: '/Users/x/secret-folder' }

  async function openWith(body: unknown) {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body })
    const wrapper = mount(SpotlightSearch, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await wrapper.vm.$nextTick()
    ;(wrapper.vm as unknown as { query: string }).query = 'app'
    await new Promise(resolve => setTimeout(resolve, 300))
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('names an agent canonically, places it by repository and workspace, and states its state in words', async () => {
    const { agentTitle } = await import('@/utils/agentLabels')
    const wrapper = await openWith({ tasks: [], agents: [agent] })
    expect(document.querySelector('[data-testid="spotlight-agent-name"]')?.textContent).toBe(agentTitle(agent as never))
    expect(document.querySelector('[data-testid="spotlight-agent-where"]')?.textContent).toBe('app · feat/x')
    expect(document.querySelector('[data-testid="spotlight-agent-state"]')?.textContent).toBe('Working')
    wrapper.unmount()
  })

  it('shows no folder name, cwd or path in default results', async () => {
    const wrapper = await openWith({ tasks: [task], agents: [agent] })
    const dialog = document.querySelector('#spotlight-listbox')!
    expect(dialog.innerHTML).not.toContain('secret-folder')
    expect(dialog.innerHTML).not.toContain('/Users/')
    wrapper.unmount()
  })

  it('keeps a task a task, with its stage in words', async () => {
    const { STAGE_LABELS } = await import('@/utils/stageLabels')
    const wrapper = await openWith({ tasks: [task], agents: [] })
    expect(document.querySelector('[data-testid="spotlight-task"]')?.textContent).toContain('Build it')
    expect(document.querySelector('[data-testid="spotlight-task-stage"]')?.textContent).toBe(STAGE_LABELS.implementation)
    wrapper.unmount()
  })

  it('still moves with the arrow keys and opens with Enter', async () => {
    const wrapper = await openWith({ tasks: [task], agents: [agent] })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await wrapper.vm.$nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('navigateAgent')?.[0]?.[0]).toMatchObject({ sessionId: agent.sessionId })
    wrapper.unmount()
  })

  it('has no axe violations with results open', async () => {
    const { axe } = await import('@/utils/testA11y')
    const wrapper = await openWith({ tasks: [task], agents: [agent] })
    const root = (document.querySelector('[role="dialog"]') ?? document.body) as Element
    expect(await axe(root)).toHaveNoViolations()
    wrapper.unmount()
  })
})

describe('spotlightSearch — keyboard entry (3L)', () => {
  it('focuses the search field when it opens, so typing straight after ⌘K lands in it', async () => {
    const wrapper = mount(SpotlightSearch, { attachTo: document.body })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await wrapper.vm.$nextTick()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(document.activeElement?.getAttribute('role')).toBe('combobox')
    wrapper.unmount()
  })
})
