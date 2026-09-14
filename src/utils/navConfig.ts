import type { ActiveView } from '../composables/useViewState'

/*
 * The navigation is organised by destination:
 *
 *   Command · Agents · Runtime · Work · Projects · Insights · Settings
 *
 * A destination with one view is a single entry. A destination with several —
 * Runtime (LocalScope, System), Work (Pipeline, Schedules, Workflows) and
 * Insights (Cost, Eval) — is a captioned group of them.
 *
 * Settings is intentionally absent: it opens a modal rather than switching the
 * active view, so it cannot be a NAV_ITEMS entry (those are typed to
 * ActiveView). AppSidebar renders it as the trailing entry.
 *
 * Projects is the user-curated Dashboard Project and nothing else — not a
 * repository and not a workspace, which live under Runtime and Agents.
 */
export type NavGroup = 'Command' | 'Agents' | 'Runtime' | 'Work' | 'Projects' | 'Insights'

export interface NavItemConfig {
  view: ActiveView
  label: string
  icon: string
  group: NavGroup
}

export const NAV_GROUPS: NavGroup[] = ['Command', 'Agents', 'Runtime', 'Work', 'Projects', 'Insights']

/*
 * Labels are presentation; `view` values are persisted storage keys and never
 * change. 'cockpit' is presented as Command and 'dashboard' as Agents — see the
 * note on ActiveView in useViewState.ts.
 */
export const NAV_ITEMS: NavItemConfig[] = [
  { view: 'cockpit', label: 'Command', icon: '◈', group: 'Command' },
  { view: 'dashboard', label: 'Agents', icon: '▦', group: 'Agents' },

  { view: 'localscope', label: 'LocalScope', icon: '◉', group: 'Runtime' },
  { view: 'system', label: 'System', icon: '⬢', group: 'Runtime' },

  { view: 'pipeline', label: 'Pipeline', icon: '▤', group: 'Work' },
  { view: 'schedules', label: 'Schedules', icon: '⏱', group: 'Work' },
  { view: 'workflows', label: 'Workflows', icon: '⤳', group: 'Work' },

  { view: 'projects', label: 'Projects', icon: '◫', group: 'Projects' },

  { view: 'cost', label: 'Cost', icon: '◷', group: 'Insights' },
  { view: 'eval', label: 'Eval', icon: '⬡', group: 'Insights' },
]

/*
 * Views that still exist but are no longer destinations. Terminal lists the
 * agents whose terminal can be attached — every agent card with a live session
 * opens its own terminal — so it left the navigation. A saved `terminal` view
 * still opens it, and still has a title.
 */
const UNLISTED_VIEW_TITLES: Partial<Record<ActiveView, string>> = {
  terminal: 'Terminal',
  // Settings is a view, but the sidebar renders it as its own trailing entry.
  settings: 'Settings',
}

export function viewTitle(view: ActiveView): string {
  return NAV_ITEMS.find(i => i.view === view)?.label ?? UNLISTED_VIEW_TITLES[view] ?? 'Command'
}

/** Items of each destination, in navigation order. */
export function navSections(): { group: NavGroup, items: NavItemConfig[] }[] {
  return NAV_GROUPS.map(group => ({ group, items: NAV_ITEMS.filter(i => i.group === group) }))
}

/**
 * The destination a view sits under, when that destination is a group of
 * several views (Runtime, Work, Insights). Null for single-view destinations,
 * whose own label already names them, and for unlisted views.
 */
export function viewSection(view: ActiveView): NavGroup | null {
  const item = NAV_ITEMS.find(i => i.view === view)
  if (!item)
    return null
  return NAV_ITEMS.filter(i => i.group === item.group).length > 1 ? item.group : null
}
