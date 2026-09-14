import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import ProjectlessRootSettings from './ProjectlessRootSettings.vue'

// 3N.2: Settings → Agent folders.

let root = { root: '/Users/me/Documents/AI-Agents', isDefault: true, exists: false }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  root = { root: '/Users/me/Documents/AI-Agents', isDefault: true, exists: false }
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/agents/projectless' && (init?.method ?? 'GET') === 'GET')
      return { ok: true, json: async () => root }
    if (url === '/api/agents/projectless' && init?.method === 'PUT') {
      const { root: next } = JSON.parse(String(init.body)) as { root: string }
      if (next.includes('/.ssh'))
        return { ok: false, status: 403, json: async () => ({ error: 'cwd is inside a sensitive directory and cannot be used as a spawn working directory' }) }
      root = next ? { root: next, isDefault: false, exists: true } : { root: '/Users/me/Documents/AI-Agents', isDefault: true, exists: false }
      return { ok: true, json: async () => root }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function render() {
  const w = mount(ProjectlessRootSettings, { attachTo: document.body })
  await flushPromises()
  return w
}

describe('projectlessRootSettings', () => {
  it('shows the current folder and says when it is the default', async () => {
    const w = await render()
    expect(w.get('[data-testid="projectless-root-current"]').text()).toContain('/Users/me/Documents/AI-Agents')
    expect(w.get('[data-testid="projectless-root-current"]').text()).toContain('(default)')
    expect((w.get('[data-testid="projectless-root-input"]').element as HTMLInputElement).value).toBe('')
    w.unmount()
  })

  it('states that changing it moves nothing and that it grants no trust', async () => {
    const text = (await render()).get('[data-testid="projectless-root-rules"]').text()
    expect(text).toContain('does not move existing agent folders')
    expect(text).toContain('never this whole folder')
    expect(text).toContain('Claude Code still asks whether to trust it')
  })

  it('saves a new folder, and can go back to the default', async () => {
    const w = await render()
    await w.get('[data-testid="projectless-root-input"]').setValue('/Users/me/Agents')
    await w.get('[data-testid="projectless-root-save"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/projectless', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ root: '/Users/me/Agents' }) }))
    expect(w.get('[data-testid="projectless-root-current"]').text()).toContain('/Users/me/Agents')

    await w.get('[data-testid="projectless-root-default"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/agents/projectless', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ root: '' }) }))
    expect(w.get('[data-testid="projectless-root-current"]').text()).toContain('(default)')
    w.unmount()
  })

  it('shows the server refusing a sensitive folder and keeps the old one', async () => {
    const w = await render()
    await w.get('[data-testid="projectless-root-input"]').setValue('/Users/me/.ssh/agents')
    await w.get('[data-testid="projectless-root-save"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-testid="projectless-root-error"]').text()).toContain('sensitive directory')
    expect(w.get('[data-testid="projectless-root-current"]').text()).toContain('/Users/me/Documents/AI-Agents')
    w.unmount()
  })

  it('has no axe violations', async () => {
    const w = await render()
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
