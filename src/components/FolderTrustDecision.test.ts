import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axe } from '@/utils/testA11y'
import FolderTrustDecision from './FolderTrustDecision.vue'

const spawn = {
  pid: 7,
  cwd: '/Users/me/scratch/plain',
  status: 'running' as const,
  folderTrust: { path: '/Users/me/scratch/plain', selected: 'exit' as const },
  trustSince: null,
  error: null,
  answering: false,
}

afterEach(() => vi.unstubAllGlobals())

describe('folderTrustDecision (3M)', () => {
  it('states the exact folder and what trusting it allows, on the explicit decision surface', () => {
    const w = mount(FolderTrustDecision, { props: { spawn } })
    expect(w.get('[data-testid="folder-trust-path"]').text()).toBe('/Users/me/scratch/plain')
    expect(w.text()).toContain('read, edit, and execute files')
    expect(w.text()).toContain('never answers this for you')
  })

  // M
  it('sends nothing until a button is pressed, then only that decision', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const w = mount(FolderTrustDecision, { props: { spawn } })
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    await w.get('[data-testid="folder-trust-exit"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ decision: 'exit' })
  })

  it('has no axe violations', async () => {
    const w = mount(FolderTrustDecision, { props: { spawn }, attachTo: document.body })
    expect(await axe(w.element as Element)).toHaveNoViolations()
    w.unmount()
  })
})
