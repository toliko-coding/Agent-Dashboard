<script setup lang="ts">
import type { PermissionItem } from '@/composables/usePendingPermissions'
import type { AttentionQueue } from '@/features/attention'
import { computed, ref } from 'vue'
import AutoApprovingStrip from '@/components/AutoApprovingStrip.vue'
import ChannelScriptCallout from '@/components/shell/ChannelScriptCallout.vue'
import DashboardToolbar from '@/components/shell/DashboardToolbar.vue'
import { useNow } from '@/composables/useNow'
import { useSpawners } from '@/composables/useSpawners'
import { useViewState } from '@/composables/useViewState'
import { AgentCardGrid, AgentStatusFilterBar, AgentTable, AgentTriageBand, EmptyAgentState, useAgents } from '@/features/agents'
import { groupAgents, sortAgents } from '@/utils/agentGroup'
import { matchesStatusFilter, statusFilterCounts } from '@/utils/agentStatusFilter'
import { friendlyProjectName } from '@/utils/friendlyProjectName'

defineProps<{
  /** The canonical attention queue App.vue derives — the triage band's only source of what needs the user. */
  attention: AttentionQueue
  permissionItems: PermissionItem[]
  focusedSessionId: string | null
}>()
const emit = defineEmits<{
  approve: [taskId: string, ids: string[], remember: boolean]
  deny: [taskId: string, ids: string[]]
  openTask: [taskId: string]
}>()

// autoStart: false, exactly as App.vue calls it — useAgents holds module-level
// state, so this is the same stream App.vue already started, not a second one.
const { agents, filteredAgents, pendingCapabilityDecisions, searchQuery, selectAgent, dismissAgent, live } = useAgents({ autoStart: false })
const { dashboardLayout, dashboardSort, dashboardGroup, setDashboardGroup, dashboardProject, dashboardSpawner, dashboardStatus } = useViewState()
const { spawners } = useSpawners()
const { nowMs } = useNow()

const autoApprovingStrip = ref<InstanceType<typeof AutoApprovingStrip> | null>(null)

// Dashboard roster: project + spawner filter → sort → optional grouping. Project
// options list every known project (pre-filter) so the dropdown stays stable.
const rosterAgents = computed(() => {
  let base = filteredAgents.value
  if (dashboardProject.value !== 'all')
    base = base.filter(a => a.projectName === dashboardProject.value)
  if (dashboardSpawner.value !== 'all')
    base = base.filter(a => a.spawnerId === dashboardSpawner.value)
  if (dashboardStatus.value !== 'all')
    base = base.filter(a => matchesStatusFilter(a, dashboardStatus.value))
  return sortAgents(base, dashboardSort.value, nowMs.value)
})

// Counts come from the project/spawner-filtered set rather than the whole
// roster, so a chip never promises agents the other filters have already hidden.
const statusCounts = computed(() => {
  let base = filteredAgents.value
  if (dashboardProject.value !== 'all')
    base = base.filter(a => a.projectName === dashboardProject.value)
  if (dashboardSpawner.value !== 'all')
    base = base.filter(a => a.spawnerId === dashboardSpawner.value)
  return statusFilterCounts(base)
})
const rosterGroups = computed(() => groupAgents(rosterAgents.value, dashboardGroup.value))
// Folder filter. Internally still `project`/projectName — the stored value and
// its localStorage key are unchanged — but it filters on the agent's folder
// name, not on a persisted Dashboard Project, so the copy says "folders".
const projectOptions = computed(() => [
  { value: 'all', label: 'All folders' },
  ...[...new Set(agents.value.map(a => a.projectName))].sort().map(n => ({ value: n, label: friendlyProjectName(n) })),
])
const spawnerOptions = computed(() => [
  { value: 'all', label: 'All spawners' },
  ...spawners.value.map(s => ({ value: s.id, label: s.name })),
])

defineExpose({ rosterAgents })
</script>

<template>
  <AgentTriageBand
    :queue="attention"
    :agents="agents"
    :permission-items="permissionItems"
    :capability-decisions="pendingCapabilityDecisions"
    :focused-session-id="focusedSessionId"
    @select="selectAgent"
    @open-task="(taskId) => emit('openTask', taskId)"
    @remembered="autoApprovingStrip?.load()"
    @approve="(taskId, ids, remember) => emit('approve', taskId, ids, remember)"
    @deny="(taskId, ids) => emit('deny', taskId, ids)"
  />
  <AutoApprovingStrip ref="autoApprovingStrip" />
  <DashboardToolbar
    :layout="dashboardLayout"
    :spawner="dashboardSpawner"
    :project="dashboardProject"
    :sort-by="dashboardSort"
    :group-by="dashboardGroup"
    :search-query="searchQuery"
    :project-options="projectOptions"
    :spawner-options="spawnerOptions"
    :total-count="agents.length"
    :shown-count="rosterAgents.length"
    @update:layout="dashboardLayout = $event"
    @update:spawner="dashboardSpawner = $event"
    @update:project="dashboardProject = $event"
    @update:sort-by="dashboardSort = $event"
    @update:group-by="setDashboardGroup($event)"
    @update:search-query="searchQuery = $event"
  />
  <AgentStatusFilterBar
    v-model="dashboardStatus"
    :counts="statusCounts"
    class="mb-3"
  />
  <template v-if="dashboardLayout === 'list'">
    <EmptyAgentState v-if="rosterAgents.length === 0" :search-query="searchQuery" />
    <AgentTable v-else :agents="rosterAgents" :groups="rosterGroups" :attention-items="attention.items" :stale="!live" @select="selectAgent" />
  </template>
  <template v-else>
    <EmptyAgentState v-if="rosterAgents.length === 0" :search-query="searchQuery" />
    <AgentCardGrid v-else :agents="rosterAgents" :groups="rosterGroups" :group-by="dashboardGroup" :attention-items="attention.items" :stale="!live" @select="selectAgent" @dismiss="dismissAgent" />
  </template>
  <ChannelScriptCallout />
</template>
