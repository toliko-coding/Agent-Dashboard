import type { AuditEntry } from '../types'
import type { ActivityEvent } from '../utils/activityEvents'
import { computed, ref, shallowRef } from 'vue'
import { toActivityFeed } from '../utils/activityEvents'
import { useVisibilityPolling } from './useVisibilityPolling'

/*
 * The activity feed reads the server audit log.
 *
 * There is no SSE stream for audit events, so this polls — but at 30s, through
 * useVisibilityPolling, which stops entirely while the tab is hidden. State is
 * module-level so several components (feed panel, a future counter) share one
 * request rather than each opening their own, per the phase's performance rule.
 */
const DEFAULT_LIMIT = 30
const POLL_MS = 30_000

const entries = shallowRef<AuditEntry[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
/** True once a response has been seen, so "empty" can be told from "not yet". */
const loaded = ref(false)

async function fetchActivity(): Promise<void> {
  try {
    const res = await fetch(`/api/audit?limit=${DEFAULT_LIMIT}`)
    if (!res.ok) {
      error.value = `Failed to load activity (${res.status})`
      return
    }
    const body = await res.json() as AuditEntry[] | null
    entries.value = Array.isArray(body) ? body : []
    error.value = null
    loaded.value = true
  }
  catch {
    error.value = 'Network error loading activity.'
  }
  finally {
    isLoading.value = false
  }
}

const events = computed<ActivityEvent[]>(() => toActivityFeed(entries.value))

export function useActivityFeed() {
  // Registers this component's lifecycle hooks; the fetched state above is
  // module-level, so two consumers share one result set rather than two caches.
  useVisibilityPolling(fetchActivity, POLL_MS)

  return {
    events,
    isLoading,
    loaded,
    error,
    refetch: fetchActivity,
  }
}
