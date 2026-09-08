import type { ActiveView } from '../composables/useViewState'
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, NAV_ITEMS, viewTitle } from './navConfig'

describe('navConfig', () => {
  it('has one item per ActiveView', () => {
    const views = NAV_ITEMS.map(i => i.view).sort()
    expect(views).toEqual([
      'cockpit',
      'cost',
      'dashboard',
      'eval',
      'localscope',
      'pipeline',
      'projects',
      'schedules',
      'system',
      'terminal',
      'workflows',
    ])
  })

  // The two renamed destinations keep their original view ids because those ids
  // are persisted in localStorage; only the label changed.
  it('presents cockpit as Overview and dashboard as Agents', () => {
    expect(NAV_ITEMS[0].view).toBe('cockpit')
    expect(viewTitle('cockpit')).toBe('Overview')
    expect(viewTitle('dashboard')).toBe('Agents')
  })

  it('groups are Main, Automation, Tools and Insights', () => {
    expect(NAV_GROUPS).toEqual(['Main', 'Automation', 'Tools', 'Insights'])
  })

  it('keeps every previously shipped view reachable', () => {
    const views = NAV_ITEMS.map(i => i.view)
    for (const view of ['pipeline', 'schedules', 'workflows', 'cost', 'eval'] as ActiveView[])
      expect(views).toContain(view)
  })

  it('groups Pipeline, Schedules and Workflows under Automation', () => {
    const automation = NAV_ITEMS.filter(i => i.group === 'Automation').map(i => i.view)
    expect(automation).toEqual(['pipeline', 'schedules', 'workflows'])
  })

  it('groups Cost and Eval under Insights', () => {
    const insights = NAV_ITEMS.filter(i => i.group === 'Insights').map(i => i.view)
    expect(insights).toEqual(['cost', 'eval'])
  })

  // Settings is a modal, not a view, so it must not appear here — AppSidebar
  // renders it as its own trailing System group.
  it('contains no Settings entry', () => {
    expect(NAV_ITEMS.some(i => i.label === 'Settings')).toBe(false)
    expect(NAV_GROUPS).not.toContain('System' as never)
  })

  it('every item belongs to a known group', () => {
    for (const item of NAV_ITEMS)
      expect(NAV_GROUPS).toContain(item.group)
  })

  it('viewTitle returns the label for a view', () => {
    expect(viewTitle('cost')).toBe('Cost')
    expect(viewTitle('localscope')).toBe('LocalScope')
  })
})
