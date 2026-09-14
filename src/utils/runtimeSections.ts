/*
 * The Runtime page's sections. One list, read by the page's local navigation
 * and by the topbar ("Runtime / Services").
 *
 * Only sections with something of their own to show. Network is a single count
 * with no per-connection data behind it, so it is a line on the Overview rather
 * than a tab that would hold one number.
 */
export type RuntimeSection = 'overview' | 'workspaces' | 'services' | 'processes' | 'devices'

export interface RuntimeSectionMeta {
  id: RuntimeSection
  label: string
}

export const RUNTIME_SECTIONS: readonly RuntimeSectionMeta[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'services', label: 'Services' },
  { id: 'processes', label: 'Processes' },
  { id: 'devices', label: 'Devices' },
]

export const DEFAULT_RUNTIME_SECTION: RuntimeSection = 'overview'

/** Where the open section is remembered. Shared with the view-state migration of the retired System view. */
export const RUNTIME_SECTION_STORAGE_KEY = 'runtime-active-section'

export function isRuntimeSection(value: unknown): value is RuntimeSection {
  return RUNTIME_SECTIONS.some(s => s.id === value)
}

export function runtimeSectionMeta(section: RuntimeSection): RuntimeSectionMeta {
  return RUNTIME_SECTIONS.find(s => s.id === section) ?? RUNTIME_SECTIONS[0]
}
