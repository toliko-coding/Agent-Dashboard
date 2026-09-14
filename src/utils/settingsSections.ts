/*
 * The Settings sections and how the page groups them. One list, read by the
 * Settings page's navigation, its compact section picker and the topbar.
 *
 * Section ids are the ones the modal used and the ids a remembered section is
 * stored under; labels are unchanged. Groups are presentation only: they own no
 * data and move nothing between features.
 */
export type SettingsSection
  = | 'appearance' | 'notifications'
    | 'spawners' | 'providers' | 'systemPrompts' | 'agentFolders'
    | 'permissionPresets' | 'grants' | 'apiKeys' | 'remotes'
    | 'pipelineConfig' | 'tracker'
    | 'projects'
    | 'registry' | 'memory' | 'obsidian'
    | 'github' | 'plugins'
    | 'server' | 'analytics'

export type SettingsGroup = 'General' | 'Agents' | 'Access' | 'Work' | 'Projects' | 'Resources' | 'Integrations' | 'System'

export interface SettingsSectionMeta {
  id: SettingsSection
  label: string
  icon: string
  group: SettingsGroup
  /** Shown only when sign-in is enabled. */
  requiresAuth?: boolean
}

export const SETTINGS_GROUPS: SettingsGroup[] = ['General', 'Agents', 'Access', 'Work', 'Projects', 'Resources', 'Integrations', 'System']

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'appearance', icon: '◑', label: 'Appearance', group: 'General' },
  { id: 'notifications', icon: '🔔', label: 'Notifications', group: 'General' },

  { id: 'spawners', icon: '⚙', label: 'Spawners', group: 'Agents' },
  { id: 'providers', icon: '🧩', label: 'Providers', group: 'Agents' },
  { id: 'systemPrompts', icon: '✦', label: 'System Prompts', group: 'Agents' },
  // Where New Agent creates projectless workspaces (3N.2).
  { id: 'agentFolders', icon: '▣', label: 'Agent folders', group: 'Agents' },

  { id: 'permissionPresets', icon: '⚿', label: 'Permissions', group: 'Access' },
  { id: 'grants', icon: '🛡', label: 'Grants', group: 'Access' },
  { id: 'apiKeys', icon: '⬡', label: 'API Keys', group: 'Access' },
  { id: 'remotes', icon: '⌂', label: 'My Remotes', group: 'Access', requiresAuth: true },

  { id: 'pipelineConfig', icon: '⛓', label: 'Pipeline', group: 'Work' },
  { id: 'tracker', icon: '🔗', label: 'Tracker', group: 'Work' },

  // The user-curated Dashboard Project — not a repository or a workspace.
  { id: 'projects', icon: '◫', label: 'Projects', group: 'Projects' },

  { id: 'registry', icon: '▤', label: 'Registry', group: 'Resources' },
  { id: 'memory', icon: '🧠', label: 'Memory', group: 'Resources' },
  { id: 'obsidian', icon: '🗒', label: 'Obsidian', group: 'Resources' },

  { id: 'github', icon: '⑂', label: 'GitHub', group: 'Integrations' },
  { id: 'plugins', icon: '🔌', label: 'Plugins', group: 'Integrations' },

  { id: 'server', icon: '🖳', label: 'Server', group: 'System' },
  { id: 'analytics', icon: '📊', label: 'Analytics', group: 'System' },
]

export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'appearance'

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && SETTINGS_SECTIONS.some(s => s.id === value)
}

export function settingsSectionMeta(id: SettingsSection): SettingsSectionMeta {
  return SETTINGS_SECTIONS.find(s => s.id === id) ?? SETTINGS_SECTIONS[0]
}
