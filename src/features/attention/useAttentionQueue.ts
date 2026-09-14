import type { Ref } from 'vue'
import type { AttentionQueue } from './queue'
import type { PermissionItem } from '@/composables/usePendingPermissions'
import { computed } from 'vue'
import { useAgents } from '@/features/agents'
import { useTasks } from '@/features/pipeline'
import { attentionQueueState, buildAttentionQueue } from './queue'

/**
 * The attention queue over the streams App.vue already runs.
 *
 * Both composables are asked with autoStart:false, so this opens nothing.
 * `permissionItems` is passed in rather than re-created because
 * usePendingPermissions is per instance and fetches for every blocked task: a
 * second instance would double those requests.
 *
 * Call it once, where the permission items live, and hand the result down —
 * every consumer then counts the same queue.
 */
export function useAttentionQueue(permissionItems: Ref<PermissionItem[]>) {
  const { agents, pendingCapabilityDecisions, pendingFolderTrust, lastUpdatedAt, error, live } = useAgents({ autoStart: false })
  const { tasks, isLoading: tasksLoading } = useTasks({ autoStart: false })

  const items = computed(() => buildAttentionQueue({
    agents: agents.value,
    permissionItems: permissionItems.value,
    capabilityDecisions: pendingCapabilityDecisions.value,
    tasks: tasks.value,
    // Server-owned folder trust questions, from the agents stream (3M.1).
    spawnTrust: pendingFolderTrust.value.map(t => ({ pid: t.pid, cwd: t.path, since: t.since })),
  }))

  return computed<AttentionQueue>(() => attentionQueueState({
    items: items.value,
    agentsObserved: lastUpdatedAt.value !== null,
    agentsError: error.value,
    tasksLoading: tasksLoading.value,
    live: live.value,
  }))
}
