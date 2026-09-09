<script setup lang="ts">
import type { PanelState } from '../panelState'
import { computed } from 'vue'
import MetricCard from '@/components/ui/MetricCard.vue'
import { useProjects } from '@/composables/useProjects'
import { useAgents } from '@/features/agents'
import { formatAge, useLocalMachine } from '@/features/localscope'
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
 * Machine metrics, from the dashboard's own normalized snapshot.
 *
 * This row no longer speaks to LocalScope. It reads GET
 * /api/localscope/snapshot, so it knows nothing about the collector's envelope
 * or that it is a separate process — the backend owns that translation, and a
 * change to LocalScope's contract lands there rather than here.
 *
 * The null-vs-zero rule travels the whole way: LocalScope reports `null` for a
 * category it did not measure, the normalizer preserves it, and `notAsked`
 * renders an em dash. A count of 0 is a real measurement and renders as 0.
 */
const { snapshot, loaded: machineLoaded } = useLocalMachine()

/** Turns a snapshot count into a panel state, honouring null-vs-zero. */
function collectorState(count: number | null | undefined): PanelState {
  if (!machineLoaded.value)
    return 'loading'
  // Nothing usable at all: the machine is unknown, not empty.
  if (snapshot.value.source === 'unavailable')
    return 'notAsked'
  if (count === null || count === undefined)
    return 'notAsked'
  return count === 0 ? 'empty' : 'ready'
}

/** The reason line shown when a metric is unavailable. */
function collectorMessage(notCollected = 'Not collected yet'): string {
  if (snapshot.value.source === 'unavailable')
    return 'LocalScope not connected'
  return notCollected
}

/*
 * A stale reading keeps its value — discarding it would turn "I cannot see the
 * machine right now" into "the machine has nothing on it" — but it must never
 * be shown as if it were current, so every stale card carries its age.
 */
const staleHint = computed(() => {
  if (snapshot.value.source !== 'stale')
    return null
  const age = formatAge(snapshot.value.ageMs)
  return age === null ? 'stale' : `stale · ${age}`
})

/** Names the degraded sources so a partial reading explains itself. */
const degradedHint = computed(() => {
  if (snapshot.value.source !== 'degraded' || snapshot.value.degraded.length === 0)
    return null
  return `partial · ${snapshot.value.degraded.map(d => d.source).join(', ')}`
})

/**
 * Hint precedence: staleness first, because it qualifies the number itself;
 * then degradation; then the card's own descriptive hint.
 */
function hintFor(own: string | undefined, count: number | null): string | undefined {
  if (staleHint.value)
    return staleHint.value
  if (degradedHint.value)
    return degradedHint.value
  return count ? own : undefined
}

const servicesCount = computed(() => snapshot.value.counts.services)
const devicesCount = computed(() => snapshot.value.counts.devices)
const networkCount = computed(() => snapshot.value.counts.network)
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
      :hint="hintFor('listening', servicesCount)"
      :message="collectorMessage()"
    />
    <MetricCard
      label="Devices"
      icon="▣"
      :state="collectorState(devicesCount)"
      :value="devicesCount ?? undefined"
      :hint="hintFor('connected', devicesCount)"
      :message="collectorMessage('Device adapters unavailable')"
    />
    <!--
      Network is a real count: LocalScope collects outbound connections and
      reports them as summary.network.active. It reads "not collected" only
      when that collector actually degraded.
    -->
    <MetricCard
      label="Network"
      icon="◍"
      :state="collectorState(networkCount)"
      :value="networkCount ?? undefined"
      :hint="hintFor('active', networkCount)"
      :message="collectorMessage()"
    />
  </div>
</template>
