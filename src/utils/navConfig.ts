import type { ActiveView } from '../composables/useViewState'

/*
 * 'System' is intentionally absent: the only item under it is Settings, which
 * opens a modal rather than switching the active view, so it cannot be a
 * NAV_ITEMS entry (those are typed to ActiveView). AppSidebar renders it as its
 * own trailing group.
 */
export type NavGroup = 'Main' | 'Automation' | 'Tools' | 'Insights'

export interface NavItemConfig {
  view: ActiveView
  label: string
  icon: string
  group: NavGroup
}

export const NAV_GROUPS: NavGroup[] = ['Main', 'Automation', 'Tools', 'Insights']

/*
 * Labels are presentation; `view` values are persisted storage keys. 'cockpit'
 * and 'dashboard' are deliberately relabelled rather than renamed — see the
 * note on ActiveView in useViewState.ts.
 */
export const NAV_ITEMS: NavItemConfig[] = [
  { view: 'cockpit', label: 'Overview', icon: '◈', group: 'Main' },
  { view: 'dashboard', label: 'Agents', icon: '▦', group: 'Main' },
  { view: 'projects', label: 'Projects', icon: '◫', group: 'Main' },
  { view: 'localscope', label: 'LocalScope', icon: '◉', group: 'Main' },

  { view: 'pipeline', label: 'Pipeline', icon: '▤', group: 'Automation' },
  { view: 'schedules', label: 'Schedules', icon: '⏱', group: 'Automation' },
  { view: 'workflows', label: 'Workflows', icon: '⤳', group: 'Automation' },

  { view: 'terminal', label: 'Terminal', icon: '▮', group: 'Tools' },
  { view: 'system', label: 'System', icon: '⬢', group: 'Tools' },

  { view: 'cost', label: 'Cost', icon: '◷', group: 'Insights' },
  { view: 'eval', label: 'Eval', icon: '⬡', group: 'Insights' },
]

export function viewTitle(view: ActiveView): string {
  return NAV_ITEMS.find(i => i.view === view)?.label ?? 'Dashboard'
}
