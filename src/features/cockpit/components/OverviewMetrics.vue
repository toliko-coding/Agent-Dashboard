<script setup lang="ts">
import type { PanelState } from '../panelState'
import { computed } from 'vue'
import MetricCard from '@/components/ui/MetricCard.vue'
import { useProjects } from '@/composables/useProjects'
import { useAgents } from '@/features/agents'
import { DataFreshnessIndicator, formatAge, useLocalMachine } from '@/features/localscope'
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
 *
 * Staleness is the ONE qualifier that legitimately belongs on every card: the
 * whole reading was taken at one moment, so if that moment has passed, it has
 * passed for all six counts equally.
 */
const staleHint = computed(() =>
  snapshot.value.source === 'stale'
    ? (formatAge(snapshot.value.ageMs) === null ? 'stale' : `stale · ${formatAge(snapshot.value.ageMs)}`)
    : null)

/*
 * Degradation, by contrast, is NOT attributable to a card, and this is a fact
 * about LocalScope's contract rather than a limitation of this component.
 *
 * `degraded` is scoped to the endpoint's whole payload — its envelope.ts says
 * an empty array means "every collector contributing to `data` succeeded" — and
 * `data` here is the entire summary. The source is a free-form identifier from
 * an open vocabulary ('lsof:listen', 'adb', 'simctl', 'docker', 'ps', …), and
 * nothing in the contract says which count a given source fed.
 *
 * So a source→metric map would be a guess this repository invented, and it
 * would fail in both directions: a renamed or new collector would either be
 * silently dropped (hiding a real degradation) or attributed to the wrong
 * number. Attaching it to every card is what shipped, and it read as though a
 * simulator-runtime problem made the network count partial.
 *
 * Machine scope is the honest scope, so it is stated once, below the row.
 */
const machineDegradation = computed(() =>
  snapshot.value.source === 'stale' || snapshot.value.degraded.length === 0
    ? null
    : snapshot.value)

/**
 * Hint precedence: staleness qualifies the number itself, so it wins; otherwise
 * the card's own descriptive hint.
 */
function hintFor(own: string | undefined, count: number | null): string | undefined {
  return staleHint.value ?? (count ? own : undefined)
}

const servicesCount = computed(() => snapshot.value.counts.services)
const devicesCount = computed(() => snapshot.value.counts.devices)
const networkCount = computed(() => snapshot.value.counts.network)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="overview-metrics">
      <!--
      "Agents", not "Active Agents": the value is agents.length — every agent
      the scan found — while the hint below it breaks that total into running
      and quiet. The old label claimed a filter the number does not apply, so a
      roster of four agents with one running read as four active ones. The
      count is deliberately unchanged; only the label was wrong.
    -->
      <MetricCard
        label="Agents"
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

    <!--
      Machine-scope degradation, stated once. See machineDegradation above for
      why it cannot honestly be attached to any single card.
    -->
    <p
      v-if="machineDegradation"
      class="flex items-center gap-1.5 px-0.5 text-[11px] text-fg-mute"
      data-testid="machine-degradation"
    >
      <span aria-hidden="true">◍</span>
      <span>Some of this machine's data is reduced:</span>
      <DataFreshnessIndicator :reading="machineDegradation" />
    </p>
  </div>
</template>
