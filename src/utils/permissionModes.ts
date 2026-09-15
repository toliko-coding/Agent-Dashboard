/*
 * Claude's permission modes, named once.
 *
 * These strings are the contract with claude's own --permission-mode flag, and
 * the server validates against the same set (allowedPermissionModes in
 * server/internal/api/agents/spawn.go). They are shown in two different places
 * — choosing a mode when starting an agent, and reporting the mode a running
 * session was started with — so the wording lives here rather than being typed
 * out twice and drifting into two vocabularies for one thing.
 *
 * The mode is read by claude once, at startup. Nothing in the dashboard can
 * change the posture of a session that is already running, which is why the
 * reporting side below deliberately has no setter.
 */

export type PermissionMode
  = 'default' | 'plan' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'dontAsk'

export const PERMISSION_MODE_OPTIONS: Array<{ value: PermissionMode, label: string }> = [
  { value: 'default', label: 'Ask for permission (default)' },
  { value: 'plan', label: 'Plan mode (read-only)' },
  { value: 'acceptEdits', label: 'Auto-accept edits' },
  { value: 'auto', label: 'Auto (smart approvals)' },
  { value: 'bypassPermissions', label: 'Bypass all permissions (dangerous)' },
  { value: 'dontAsk', label: 'Never ask (dangerous)' },
]

/**
 * Modes that skip every confirmation prompt. `auto` and `plan` are not here:
 * auto still asks for what it cannot approve, and plan cannot change anything.
 */
export const DANGEROUS_PERMISSION_MODES: ReadonlySet<string> = new Set<string>(['bypassPermissions', 'dontAsk'])

export function isDangerousPermissionMode(mode: string): boolean {
  return DANGEROUS_PERMISSION_MODES.has(mode)
}

/**
 * Human wording for a mode. An unrecognised value is returned as given: it came
 * from a real process's command line, and showing it verbatim is more honest
 * than mapping it onto a mode the session is not running.
 */
export function permissionModeLabel(mode: string): string {
  return PERMISSION_MODE_OPTIONS.find(o => o.value === mode)?.label ?? mode
}

/**
 * Short wording for a badge, where the full sentence does not fit.
 */
const SHORT_LABELS: Record<string, string> = {
  default: 'Asks permission',
  plan: 'Plan (read-only)',
  acceptEdits: 'Auto-accepts edits',
  auto: 'Auto approvals',
  bypassPermissions: 'Bypasses permissions',
  dontAsk: 'Never asks',
}

export function permissionModeShortLabel(mode: string): string {
  return SHORT_LABELS[mode] ?? mode
}
