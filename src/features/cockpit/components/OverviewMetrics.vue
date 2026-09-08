<script setup lang="ts">
import type { PanelState } from '../panelState'
import { computed } from 'vue'
import MetricCard from '@/components/ui/MetricCard.vue'
import { useProjects } from '@/composables/useProjects'
import { useAgents } from '@/features/agents'
import { matchesStatusFilter } from '@/utils/agentStatusFilter'

/*
 * The metric row. Each card is either a real measurement or an explicit
 * "not collected yet" — see MetricCard for why the difference is enforced
 * rather than left to the caller.
 *
 * Shared singletons only: useAgents and useProjects are the streams App.vue
 * already started (autoStart:false), so this row opens no new request.
 */
const { agents, isLoading: agentsLoading, error: agentsError } = useAgents({ autoStart: false })
const { projects, isLoading: projectsLoading, error: projectsError } = useProjects()

function listState(loading: boolean, error: string | null, count: number): PanelState {
  if (error)
    return 'failed'
  if (loading)
    return 'loading'
  return count === 0 ? 'empty' : 'ready'
}

const runningCount = computed(() => agents.value.filter(a => matchesStatusFilter(a, 'running')).length)
const waitingCount = computed(() => agents.value.filter(a => matchesStatusFilter(a, 'waiting')).length)

const agentState = computed(() => listState(agentsLoading.value, agentsError.value, agents.value.length))
const projectState = computed(() => listState(projectsLoading.value, projectsError.value, projects.value.length))

/*
 * Capabilities with no collector at all. `notAsked` is the honest state: the
 * scanner discards every non-agent process by design, and nothing samples
 * network or emulators. When LocalScope lands these become real metrics with
 * no change to this layout.
 */
const UNAVAILABLE: { label: string, icon: string, message: string }[] = [
  { label: 'Local Services', icon: '▤', message: 'LocalScope not connected' },
  { label: 'Emulators', icon: '▣', message: 'Not collected yet' },
  { label: 'Network', icon: '◍', message: 'Not collected yet' },
]
</script>

<template>
  <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="overview-metrics">
    <MetricCard
      label="Active Agents"
      icon="◈"
      :state="agentState"
      :value="agents.length"
      :hint="agents.length ? `${runningCount} running · ${waitingCount} quiet` : undefined"
      :message="agentsError ?? undefined"
    />
    <MetricCard
      label="Projects"
      icon="◫"
      :state="projectState"
      :value="projects.length"
      :message="projectsError ?? undefined"
      hint="registered"
    />
    <MetricCard
      v-for="u in UNAVAILABLE"
      :key="u.label"
      :label="u.label"
      :icon="u.icon"
      state="notAsked"
      :message="u.message"
    />
  </div>
</template>
