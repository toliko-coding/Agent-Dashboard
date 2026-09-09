<script setup lang="ts">
import type { PanelState } from '../panelState'
import { computed } from 'vue'
import MetricCard from '@/components/ui/MetricCard.vue'
import { useProjects } from '@/composables/useProjects'
import { useAgents } from '@/features/agents'
import { useLocalScopeSummary } from '@/features/localscope'
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
 * LocalScope-backed metrics.
 *
 * LocalScope's own contract carries the same distinction this row enforces: a
 * count of `null` means NOT COLLECTED, never zero (see its summary.ts). So the
 * mapping is direct — null becomes `notAsked`, a number becomes `ready`/`empty`
 * — and nothing here has to invent a fallback.
 */
const summary = useLocalScopeSummary()

/** Turns a LocalScope count into a panel state, honouring null-vs-zero. */
function collectorState(count: number | null | undefined): PanelState {
  if (summary.reachable.value === false)
    return 'notAsked'
  if (summary.error.value)
    return 'failed'
  if (!summary.loaded.value)
    return 'loading'
  if (count === null || count === undefined)
    return 'notAsked'
  return count === 0 ? 'empty' : 'ready'
}

/** The reason line shown when a metric is unavailable. */
function collectorMessage(notCollected = 'Not collected yet'): string {
  if (summary.reachable.value === false)
    return 'LocalScope not connected'
  return summary.error.value ?? notCollected
}

const servicesCount = computed(() => summary.data.value?.services.running ?? null)
const devicesCount = computed(() => summary.data.value?.devices.connected ?? null)
const networkCount = computed(() => summary.data.value?.network.active ?? null)
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
      label="Local Services"
      icon="▤"
      :state="collectorState(servicesCount)"
      :value="servicesCount ?? undefined"
      :hint="servicesCount ? 'listening' : undefined"
      :message="collectorMessage()"
    />
    <MetricCard
      label="Devices"
      icon="▣"
      :state="collectorState(devicesCount)"
      :value="devicesCount ?? undefined"
      :hint="devicesCount ? 'connected' : undefined"
      :message="collectorMessage('Device adapters unavailable')"
    />
    <!--
      Network stays unavailable even when LocalScope is running: it has the
      model but no collector yet, so its summary reports network.active as
      null. This card flips to real data the moment that lands, unchanged.
    -->
    <MetricCard
      label="Network"
      icon="◍"
      :state="collectorState(networkCount)"
      :value="networkCount ?? undefined"
      :message="collectorMessage()"
    />
  </div>
</template>
