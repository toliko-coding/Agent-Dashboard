import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useSettingsSection } from '@/composables/useSettingsSection'
import { useTheme } from '@/composables/useTheme'
import { useViewState } from '@/composables/useViewState'
import SettingsView from '@/features/settings/components/SettingsView.vue'
import { axe } from '@/utils/testA11y'

/*
 * Settings as a page (3J). The section list is data-driven (utils/settingsSections),
 * so these guard that every section stays reachable, that choosing one opens the
 * panel it names, and that the page keeps what the modal did.
 */

const NAV_LABELS = [
  'Appearance',
  'Notifications',
  'Spawners',
  'Providers',
  'System Prompts',
  'Agent folders',
  'Permissions',
  'Grants',
  'API Keys',
  'Pipeline',
  'Tracker',
  'Projects',
  'Registry',
  'Memory',
  'Obsidian',
  'GitHub',
  'Plugins',
  'Server',
  'Analytics',
]
const GROUPS = ['General', 'Agents', 'Access', 'Work', 'Projects', 'Resources', 'Integrations', 'System']
const SECRET_TOKEN = 'tok_live_SECRETSECRETSECRET_9f3a'

let created: { key: object, token: string } | null = null

function fetchStub() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/settings/api-keys' && init?.method === 'POST')
      return { ok: true, status: 200, json: async () => created }
    if (url === '/api/settings/api-keys')
      return { ok: true, status: 200, json: async () => [{ id: 'k1', name: 'CI key', scopes: ['tasks:read'], active: true, userId: null, createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null }] }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const wrappers: { unmount: () => void }[] = []
function mountSettings() {
  const w = mount(SettingsView, { attachTo: document.body })
  wrappers.push(w)
  return w
}

function navButton(w: ReturnType<typeof mountSettings>, label: string) {
  const button = w.findAll('nav[aria-label="Settings sections"] button').find(b => b.text().replace(/\s+/g, ' ').trim().endsWith(label))
  if (!button)
    throw new Error(`nav item "${label}" not found`)
  return button
}

// The panels are lazy, so a section is empty for a tick or two after choosing it.
async function openPanel(w: ReturnType<typeof mountSettings>, label: string, marker: string) {
  await navButton(w, label).trigger('click')
  await vi.waitUntil(() => w.find(marker).exists() || document.querySelector(marker), { timeout: 2000, interval: 10 })
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  useSettingsSection().activeSection.value = 'appearance'
  created = null
  vi.stubGlobal('fetch', fetchStub())
})

afterEach(() => {
  wrappers.splice(0).forEach(w => w.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('settings page — structure', () => {
  // A
  it('renders as a page in the shell, not as a dialog', async () => {
    const w = mountSettings()
    await flushPromises()
    expect(w.find('[data-testid="settings-page"]').exists()).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(w.find('nav[aria-label="Settings sections"]').exists()).toBe(true)
  })

  // B
  it('keeps every section reachable, grouped (sign-in off hides My Remotes)', async () => {
    const w = mountSettings()
    await flushPromises()
    const labels = w.findAll('nav[aria-label="Settings sections"] button').map(b => b.text().replace(/\s+/g, ' ').trim())
    expect(labels).toHaveLength(NAV_LABELS.length)
    for (const label of NAV_LABELS)
      expect(labels.some(l => l.endsWith(label)), label).toBe(true)
    expect(labels.some(l => l.includes('My Remotes'))).toBe(false)
    expect(w.findAll('nav[aria-label="Settings sections"] h2').map(h => h.text())).toEqual(GROUPS)
    // The compact picker offers the same sections.
    expect(w.findAll('[data-testid="settings-section-select"] option')).toHaveLength(NAV_LABELS.length)
  })

  // Registry and Memory render sibling panels, so a swapped section is invisible without pinning which panel each opens.
  it('opens the panel each nav item names', async () => {
    const w = mountSettings()
    await flushPromises()
    await openPanel(w, 'Registry', '[data-testid="resource-kind-application"]')
    expect(w.find('[data-testid="memory-space-new"]').exists()).toBe(false)
    await openPanel(w, 'Memory', '[data-testid="memory-space-new"]')
    expect(w.find('[data-testid="resource-kind-application"]').exists()).toBe(false)
  })

  it('gives the open section a heading and states its group', async () => {
    const w = mountSettings()
    await flushPromises()
    await navButton(w, 'Plugins').trigger('click')
    expect(w.get('[data-testid="settings-section-heading"]').text()).toBe('Plugins')
    expect(w.get('[data-testid="settings-content"]').attributes('data-section')).toBe('plugins')
  })
})

describe('settings page — navigation', () => {
  // C
  it('uses real buttons that report the current section', async () => {
    const w = mountSettings()
    await flushPromises()
    const plugins = navButton(w, 'Plugins')
    expect(plugins.element.tagName).toBe('BUTTON')
    expect(plugins.attributes('type')).toBe('button')
    await plugins.trigger('click')
    expect(plugins.attributes('aria-current')).toBe('page')
    expect(navButton(w, 'Appearance').attributes('aria-current')).toBeUndefined()
  })

  it('lets the compact picker choose a section', async () => {
    const w = mountSettings()
    await flushPromises()
    await w.get('[data-testid="settings-section-select"]').setValue('server')
    expect(w.get('[data-testid="settings-content"]').attributes('data-section')).toBe('server')
    expect(w.find('label[for="settings-section-select"]').exists()).toBe(true)
  })

  it('does not leave Settings on Escape — there is nothing to close', async () => {
    const w = mountSettings()
    await flushPromises()
    useViewState().activeView.value = 'settings'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(useViewState().activeView.value).toBe('settings')
    expect(w.emitted('close')).toBeUndefined()
  })
})

describe('settings page — state', () => {
  // D
  it('remembers the open section across visits', async () => {
    const first = mountSettings()
    await flushPromises()
    await navButton(first, 'Plugins').trigger('click')
    first.unmount()
    wrappers.splice(0)
    expect(localStorage.getItem('settings-active-section')).toBe('plugins')
    const second = mountSettings()
    await flushPromises()
    expect(navButton(second, 'Plugins').attributes('aria-current')).toBe('page')
  })

  it('keeps a changed preference: the theme choice persists as before', async () => {
    const w = mountSettings()
    await flushPromises()
    const dark = w.findAll('button[aria-pressed]').find(b => b.text().includes('Dark Mode'))!
    await dark.trigger('click')
    await nextTick()
    expect(dark.attributes('aria-pressed')).toBe('true')
    expect(useTheme().preference.value).toBe('dark')
    await w.findAll('button[aria-pressed]').find(b => b.text().includes('System'))!.trigger('click')
  })

  // F
  it('opens at the section a caller asked for', async () => {
    useSettingsSection().openSettings('projects')
    const w = mountSettings()
    await flushPromises()
    expect(useViewState().activeView.value).toBe('settings')
    expect(navButton(w, 'Projects').attributes('aria-current')).toBe('page')
  })
})

describe('settings page — API keys', () => {
  // G and H: the nested dialogs still work, and secrets stay where they were.
  it('opens and cancels the create-key dialog over the page', async () => {
    const w = mountSettings()
    await flushPromises()
    await navButton(w, 'API Keys').trigger('click')
    await vi.waitUntil(() => w.text().includes('CI key'), { timeout: 2000 })
    await w.findAll('button').find(b => b.text().includes('+ Add Key'))!.trigger('click')
    await nextTick()
    expect(document.body.textContent).toContain('Create API Key')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    ;[...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Cancel')!.click()
    await nextTick()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(w.find('[data-testid="settings-page"]').exists()).toBe(true)
  })

  it('lists keys without any secret, and reveals a new token masked until asked', async () => {
    created = { key: { id: 'k2', name: 'New key', scopes: ['tasks:read'], active: true, userId: null, createdAt: '2026-09-02T00:00:00Z', lastUsedAt: null }, token: SECRET_TOKEN }
    const w = mountSettings()
    await flushPromises()
    await navButton(w, 'API Keys').trigger('click')
    await vi.waitUntil(() => w.text().includes('CI key'), { timeout: 2000 })
    expect(w.text()).not.toMatch(/tok_/)
    // The status pill keeps its word in body text colour; green text on the soft fill failed AA in light theme.
    expect(w.get('[data-testid="api-key-status-active"]').classes()).toContain('text-fg')

    await w.findAll('button').find(b => b.text().includes('+ Add Key'))!.trigger('click')
    await nextTick()
    const name = document.querySelector<HTMLInputElement>('#key-name')!
    name.value = 'New key'
    name.dispatchEvent(new Event('input'))
    await nextTick()
    ;[...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Create Key')!.click()
    await vi.waitUntil(() => document.body.textContent?.includes('Your new API key'), { timeout: 2000 })
    expect(document.body.textContent).not.toContain(SECRET_TOKEN)
    expect(document.body.textContent).toContain('tok_live')
  })
})

describe('settings page — cost and quality', () => {
  // I
  it('starts no timer or stream just by being open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] })
    mountSettings()
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)
    const source = readFileSync(resolve(process.cwd(), 'src/features/settings/components/SettingsView.vue'), 'utf8')
    expect(source).not.toMatch(/setInterval|useVisibilityPolling|EventSource|useAgents|useLocalMachine|useSystemResources/)
  })

  it('fetches API keys only when that section is opened', async () => {
    const fetchMock = fetchStub()
    vi.stubGlobal('fetch', fetchMock)
    const w = mountSettings()
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/settings/api-keys')).toBe(false)
    await navButton(w, 'API Keys').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/settings/api-keys')).toBe(true)
  })

  // K
  it('has no axe violations', async () => {
    const w = mountSettings()
    await flushPromises()
    expect(await axe(w.element as Element)).toHaveNoViolations()
  })
})
