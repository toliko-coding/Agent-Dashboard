import type { ActiveView } from '../composables/useViewState'
import { describe, expect, it } from 'vitest'
import { ACTIVE_VIEWS } from '../composables/useViewState'
import { NAV_GROUPS, NAV_ITEMS, navSections, viewSection, viewTitle } from './navConfig'

describe('navConfig — destinations', () => {
  it('is organised as Command, Agents, Runtime, Work, Projects, Insights', () => {
    expect(NAV_GROUPS).toEqual(['Command', 'Agents', 'Runtime', 'Work', 'Projects', 'Insights'])
    expect(navSections().map(s => [s.group, s.items.map(i => i.view)])).toEqual([
      ['Command', ['cockpit']],
      ['Agents', ['dashboard']],
      ['Runtime', ['localscope', 'system']],
      ['Work', ['pipeline', 'schedules', 'workflows']],
      ['Projects', ['projects']],
      ['Insights', ['cost', 'eval']],
    ])
  })

  // View ids are persisted in localStorage; only labels change.
  it('presents cockpit as Command and dashboard as Agents without renaming their ids', () => {
    expect(NAV_ITEMS[0].view).toBe('cockpit')
    expect(viewTitle('cockpit')).toBe('Command')
    expect(viewTitle('dashboard')).toBe('Agents')
  })

  it('keeps Projects its own destination, apart from Runtime', () => {
    expect(NAV_ITEMS.find(i => i.view === 'projects')?.group).toBe('Projects')
    expect(viewSection('projects')).toBeNull()
  })

  // Settings is a modal, not a view; AppSidebar renders it as the trailing entry.
  it('contains no Settings entry', () => {
    expect(NAV_ITEMS.some(i => i.label === 'Settings')).toBe(false)
  })

  it('names the section of a view inside a multi-view destination only', () => {
    expect(viewSection('localscope')).toBe('Runtime')
    expect(viewSection('workflows')).toBe('Work')
    expect(viewSection('eval')).toBe('Insights')
    expect(viewSection('cockpit')).toBeNull()
    expect(viewSection('terminal')).toBeNull()
  })
})

describe('navConfig — saved state and retired entries', () => {
  it('lists every view except Terminal, which left the navigation, and Settings, the trailing entry', () => {
    expect(NAV_ITEMS.map(i => i.view).sort()).toEqual(ACTIVE_VIEWS.filter(v => v !== 'terminal' && v !== 'settings').sort())
  })

  // A saved view id must keep resolving: nothing a user stored is invalidated.
  it('still titles every persisted view id, Terminal included', () => {
    for (const view of ACTIVE_VIEWS as ActiveView[])
      expect(viewTitle(view), view).not.toBe('')
    expect(viewTitle('terminal')).toBe('Terminal')
    expect(viewTitle('settings')).toBe('Settings')
    expect(ACTIVE_VIEWS).toContain('terminal')
  })

  it('viewTitle returns the label for a view', () => {
    expect(viewTitle('cost')).toBe('Cost')
    expect(viewTitle('localscope')).toBe('LocalScope')
  })
})
