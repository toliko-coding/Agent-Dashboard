import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '../utils/settingsSections'

async function load() {
  vi.resetModules()
  const { useSettingsSection } = await import('./useSettingsSection')
  const { useViewState } = await import('./useViewState')
  return { useSettingsSection, useViewState }
}

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('settings sections', () => {
  it('keeps all twenty sections, each in a group that exists, with no empty group', () => {
    expect(SETTINGS_SECTIONS).toHaveLength(20)
    expect(new Set(SETTINGS_SECTIONS.map(s => s.id)).size).toBe(20)
    for (const section of SETTINGS_SECTIONS)
      expect(SETTINGS_GROUPS).toContain(section.group)
    for (const group of SETTINGS_GROUPS)
      expect(SETTINGS_SECTIONS.some(s => s.group === group), group).toBe(true)
  })
})

describe('useSettingsSection', () => {
  beforeEach(() => localStorage.clear())

  it('restores the remembered section and ignores an unknown one', async () => {
    localStorage.setItem('settings-active-section', 'plugins')
    expect((await load()).useSettingsSection().activeSection.value).toBe('plugins')
    localStorage.setItem('settings-active-section', 'not-a-section')
    expect((await load()).useSettingsSection().activeSection.value).toBe('appearance')
  })

  // F: a caller that means a section reaches it.
  it('opens the Settings page at the section a caller asks for, and remembers it', async () => {
    const { useSettingsSection, useViewState } = await load()
    useSettingsSection().openSettings('projects')
    expect(useViewState().activeView.value).toBe('settings')
    expect(useSettingsSection().activeSection.value).toBe('projects')
    expect(localStorage.getItem('settings-active-section')).toBe('projects')
  })

  it('opens where the user left Settings when no section is named', async () => {
    localStorage.setItem('settings-active-section', 'server')
    const { useSettingsSection, useViewState } = await load()
    useSettingsSection().openSettings()
    expect(useViewState().activeView.value).toBe('settings')
    expect(useSettingsSection().activeSection.value).toBe('server')
  })

  // E/F: the entry points that used to say "Settings → X" now go there.
  it('wires every "Settings → …" hint to its section', () => {
    expect(read('src/features/projects/components/ProjectsView.vue')).toContain('openSettings(\'projects\')')
    expect(read('src/features/workflows/components/WorkflowsView.vue')).toContain('openSettings(\'analytics\')')
    expect(read('src/features/cockpit/components/GitHubPanel.vue')).toContain('openSettings(\'github\')')
  })

  // I: section state is plain state — no timer, stream or request.
  it('starts no timer, stream or request', () => {
    expect(read('src/composables/useSettingsSection.ts')).not.toMatch(/setInterval|setTimeout|EventSource|fetch\(/)
  })
})
