import type { AuditEntry } from '../types'

/*
 * Activity feed normalization.
 *
 * SOURCE: the server's audit log (GET /api/audit) and nothing else. That log is
 * a real, persisted, server-authored event stream — the only one this app has.
 *
 * Sources deliberately NOT merged in:
 *
 * - Agent hook events (`agent.recentHookEvents`) are per-session, held in
 *   memory with a 30-minute TTL, and require the opt-in hook scripts. There is
 *   no cross-agent accessor, so a feed built on them would be empty for most
 *   installations and would disagree with itself after a restart.
 * - Agent status transitions are not events. The SSE stream pushes full roster
 *   snapshots, so "became idle" would have to be synthesised by diffing frames
 *   in the browser: it would exist only while a tab is open, vanish on reload,
 *   and double-count across two open tabs. A feed that loses its history on
 *   refresh is not an activity log.
 * - Task/project SSE frames are CRUD notifications for live cache updates, and
 *   the same transitions already reach the audit log with an actor and a
 *   timestamp attached.
 */

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'danger'

export interface ActivityEvent {
  id: string
  /** Epoch ms, for sorting. NaN when the server sent an unparseable stamp. */
  timestamp: number
  /** Raw RFC3339 string, kept for <time datetime>. */
  timestampRaw: string
  /** Who acted: 'user', 'agent', 'orchestrator', 'system', … (server-derived). */
  actor: string
  /** Raw audit action, e.g. 'live_inject'. Kept so a row stays traceable. */
  action: string
  title: string
  detail?: string
  severity: ActivitySeverity
  /** Task this belongs to, when the audit row named one. */
  taskId?: string
}

/*
 * Human titles for the audit actions the server actually writes (see the
 * comment on the audit_event schema). An action with no entry here is NOT
 * dropped and NOT renamed — it falls back to its raw name, so a newly added
 * server action shows up honestly rather than silently disappearing.
 */
const ACTION_TITLES: Record<string, string> = {
  spawn: 'Agent spawned',
  spawn_rejected: 'Agent spawn rejected',
  live_inject: 'Message sent to agent',
  live_inject_rejected: 'Message to agent rejected',
  permission_grant: 'Permission granted',
  permission_revoke: 'Permission revoked',
  key_create: 'API key created',
  key_delete: 'API key deleted',
  task_done: 'Task completed',
  task_cancelled: 'Task cancelled',
  retry_requested: 'Task retry requested',
  worktree_removed: 'Worktree removed',
}

const SEVERITY_BY_ACTION: Record<string, ActivitySeverity> = {
  spawn: 'success',
  task_done: 'success',
  permission_grant: 'success',
  spawn_rejected: 'danger',
  live_inject_rejected: 'danger',
  task_cancelled: 'warning',
  permission_revoke: 'warning',
  retry_requested: 'warning',
}

/** Title-cases an unmapped action so 'stage_advanced' reads as 'Stage advanced'. */
function humanizeAction(action: string): string {
  if (!action)
    return 'Activity'
  const spaced = action.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function severityForAction(action: string): ActivitySeverity {
  return SEVERITY_BY_ACTION[action] ?? 'info'
}

export function toActivityEvent(entry: AuditEntry): ActivityEvent {
  const parsed = Date.parse(entry.timestamp)
  return {
    id: entry.id,
    timestamp: parsed,
    timestampRaw: entry.timestamp,
    actor: entry.actor || 'system',
    action: entry.action,
    title: ACTION_TITLES[entry.action] ?? humanizeAction(entry.action),
    detail: entry.target || undefined,
    severity: severityForAction(entry.action),
    taskId: entry.taskId ?? undefined,
  }
}

/**
 * Normalizes and orders a page of audit rows, newest first.
 *
 * Rows whose timestamp will not parse keep their place at the end rather than
 * being dropped: losing an event silently is worse than showing it last.
 */
export function toActivityFeed(entries: AuditEntry[]): ActivityEvent[] {
  return entries
    .map(toActivityEvent)
    .sort((a, b) => {
      const at = Number.isNaN(a.timestamp) ? -1 : a.timestamp
      const bt = Number.isNaN(b.timestamp) ? -1 : b.timestamp
      return bt - at
    })
}
