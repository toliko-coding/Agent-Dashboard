<script setup lang="ts">
import type { SystemInfo } from '@/composables/useSystemResources'
import type { RuntimeSection } from '@/utils/runtimeSections'
import { computed } from 'vue'
import { useBuildVersion } from '@/composables/useBuildVersion'
import { useSystemResources } from '@/composables/useSystemResources'
import { useAgents } from '@/features/agents'
import { agentFootprint, liveAgents } from '@/features/cockpit'
import { DataFreshnessIndicator, useLocalMachine } from '@/features/localscope'
import { durationLabel, gibLabel, plural } from '../format'

/*
 * The Runtime Overview: how much is running, where agents are, and what this
 * machine has left — each from the source that actually measures it.
 *
 *   Local runtime  the normalized LocalScope snapshot (counts, no lists)
 *   Agents         the agent stream the whole app already holds
 *   This machine   GET /api/system, measured by the dashboard server itself —
 *                  not by LocalScope, and labelled so
 *
 * The snapshot's rules are not reinterpreted here: a number, including 0, is a
 * measurement; null is "Not collected" and never 0; an unavailable collector
 * makes every count unknown; a stale or partial reading keeps its values and
 * says so. Network throughput genuinely is not collected — LocalScope counts
 * connections, not bytes — so that gap is named.
 *
 * No list is fetched from this section.
 */
const emit = defineEmits<{ openSection: [section: RuntimeSection] }>()

const { snapshot, loaded } = useLocalMachine()

type LocalState = 'connecting' | 'unavailable' | 'reading'
const localState = computed<LocalState>(() => {
  if (!loaded.value)
    return 'connecting'
  return snapshot.value.source === 'unavailable' ? 'unavailable' : 'reading'
})

interface CountCell {
  key: string
  label: string
  value: number | null
  unit: string
  section: RuntimeSection | null
}

const cells = computed<CountCell[]>(() => {
  const c = snapshot.value.counts
  return [
    { key: 'services', label: 'Services', value: c.services, unit: 'listening', section: 'services' },
    {
      key: 'processes',
      label: 'Processes',
      value: c.processesRelevant,
      // The denominator is its own measurement; without it, say what the number is.
      unit: c.processesTotal === null ? 'developer' : `of ${c.processesTotal}`,
      section: 'processes',
    },
    { key: 'devices', label: 'Devices', value: c.devices, unit: 'connected', section: 'devices' },
    // A count with no list behind it, so there is no section to open.
    { key: 'network', label: 'Network', value: c.network, unit: 'active connections', section: null },
  ]
})

const { agents, lastUpdatedAt } = useAgents({ autoStart: false })
const agentsObserved = computed(() => lastUpdatedAt.value !== null)
const sessions = computed(() => liveAgents(agents.value))
const footprint = computed(() => agentFootprint(sessions.value))
const footprintText = computed(() => {
  const f = footprint.value
  const parts: string[] = []
  if (f.repositories > 0)
    parts.push(`in ${plural(f.repositories, 'repository', 'repositories')}`)
  if (f.workspaces > 0)
    parts.push(plural(f.workspaces, 'workspace', 'workspaces'))
  if (f.unresolved > 0)
    parts.push(`${f.unresolved} with workspace unknown`)
  return parts.join(' · ')
})

const resources = useSystemResources()
const info = computed<SystemInfo | null>(() => resources.info.value)
const { version } = useBuildVersion()

const HIGH_PCT = 75
const CRITICAL_PCT = 90

type Level = 'normal' | 'high' | 'critical'
function level(pct: number): Level {
  if (pct >= CRITICAL_PCT)
    return 'critical'
  return pct >= HIGH_PCT ? 'high' : 'normal'
}
const LEVEL_TEXT: Record<Level, string> = { normal: 'text-fg', high: 'text-warning-text', critical: 'text-danger-text' }
// A usage bar at a normal level is neutral: green would claim the machine is healthy.
const LEVEL_BAR: Record<Level, string> = { normal: 'bg-fg-mute', high: 'bg-warning', critical: 'bg-danger' }
const LEVEL_WORD: Record<Level, string> = { normal: '', high: 'High', critical: 'Critical' }

const gauges = computed(() => {
  const i = info.value
  if (!i)
    return []
  return [
    { key: 'cpu', label: 'CPU', pct: i.cpu.usage, detail: `${i.cpu.cores} cores` },
    { key: 'memory', label: 'Memory', pct: i.memory.usagePercent, detail: `${gibLabel(i.memory.used)} of ${gibLabel(i.memory.total)}` },
    { key: 'disk', label: 'Disk', pct: i.disk.usagePercent, detail: `${gibLabel(i.disk.used)} of ${gibLabel(i.disk.total)}` },
  ].map(g => ({ ...g, level: level(g.pct) }))
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4" data-testid="runtime-overview">
    <h2 class="sr-only">
      Overview
    </h2>

    <section
      aria-labelledby="runtime-local-heading"
      class="flex min-w-0 flex-col gap-3 rounded-panel border border-line bg-card px-4 py-3.5"
      data-testid="runtime-overview-local"
      :data-state="localState"
    >
      <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="runtime-local-heading" class="m-0 text-body font-semibold text-fg">
          Local runtime
        </h3>
        <span class="text-ui-sm text-fg-mute">observed by LocalScope</span>
        <DataFreshnessIndicator v-if="localState === 'reading'" :reading="snapshot" testid="runtime-overview-freshness" />
      </header>

      <p v-if="localState === 'connecting'" class="m-0 text-ui text-fg-mute" data-testid="runtime-overview-connecting">
        Connecting to LocalScope…
      </p>

      <div v-else-if="localState === 'unavailable'" class="flex flex-col gap-2" data-testid="runtime-overview-unavailable">
        <p class="m-0 text-ui text-fg-mute">
          LocalScope is not connected, so services, processes, devices and network are unknown — not zero.
        </p>
        <p class="m-0 self-start rounded-control bg-recessed px-3 py-2 font-mono text-ui-sm text-fg-mute" data-testid="runtime-overview-start-hint">
          Start the collector: pnpm dev:collector in the LocalScope repository (127.0.0.1:7317)
        </p>
      </div>

      <template v-else>
        <ul class="m-0 grid list-none grid-cols-2 gap-2 p-0 lg:grid-cols-4" data-testid="runtime-overview-counts">
          <li
            v-for="cell in cells"
            :key="cell.key"
            class="min-w-0"
            :data-testid="`runtime-overview-${cell.key}`"
            :data-state="cell.value === null ? 'unknown' : 'measured'"
          >
            <component
              :is="cell.section ? 'button' : 'div'"
              :type="cell.section ? 'button' : undefined"
              class="flex h-full w-full min-w-0 flex-col gap-1 rounded-control border border-line bg-transparent px-3 py-2.5 text-left"
              :class="cell.section
                ? 'cursor-pointer transition-colors duration-[var(--duration-fast)] ease-standard hover:border-line-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent'
                : ''"
              @click="cell.section && emit('openSection', cell.section)"
            >
              <span class="flex items-baseline justify-between gap-2">
                <span class="text-label uppercase tracking-wider text-fg-faint">{{ cell.label }}</span>
                <span v-if="cell.section" class="text-ui-sm text-fg-faint" aria-hidden="true">→</span>
              </span>
              <span v-if="cell.value !== null" class="flex min-w-0 items-baseline gap-1.5">
                <span class="font-mono text-title font-semibold tabular-nums text-fg">{{ cell.value }}</span>
                <span class="truncate text-ui-sm text-fg-mute">{{ cell.unit }}</span>
              </span>
              <span v-else class="text-ui text-fg-mute">Not collected</span>
              <span v-if="cell.section" class="sr-only">Open {{ cell.label }}</span>
            </component>
          </li>
        </ul>
        <p class="m-0 text-ui-sm text-fg-mute" data-testid="runtime-overview-throughput">
          Network throughput is not collected — only the number of active connections.
        </p>
      </template>
    </section>

    <div class="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section
        aria-labelledby="runtime-agents-heading"
        class="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-card px-4 py-3.5"
        data-testid="runtime-overview-agents"
      >
        <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id="runtime-agents-heading" class="m-0 text-body font-semibold text-fg">
            Agents
          </h3>
          <span class="text-ui-sm text-fg-mute">from the agent stream</span>
        </header>
        <p v-if="!agentsObserved" class="m-0 text-ui text-fg-mute" data-testid="runtime-overview-agents-waiting">
          Waiting for the agent stream…
        </p>
        <template v-else>
          <p class="m-0 flex items-baseline gap-1.5">
            <span class="font-mono text-title font-semibold tabular-nums text-fg">{{ sessions.length }}</span>
            <span class="text-ui-sm text-fg-mute">running</span>
          </p>
          <p v-if="footprintText" class="m-0 text-ui-sm text-fg-mute" data-testid="runtime-overview-footprint">
            {{ footprintText }}
          </p>
          <button
            type="button"
            class="self-start cursor-pointer rounded-control border-none bg-transparent p-0 text-ui-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            data-testid="runtime-overview-open-workspaces"
            @click="emit('openSection', 'workspaces')"
          >
            Open Workspaces
          </button>
        </template>
      </section>

      <section
        aria-labelledby="runtime-machine-heading"
        class="flex min-w-0 flex-col gap-3 rounded-panel border border-line bg-card px-4 py-3.5"
        data-testid="runtime-machine"
      >
        <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id="runtime-machine-heading" class="m-0 text-body font-semibold text-fg">
            This machine
          </h3>
          <span class="text-ui-sm text-fg-mute">measured by the dashboard server</span>
        </header>

        <p v-if="!info && !resources.error.value" class="m-0 text-ui text-fg-mute" data-testid="runtime-machine-loading">
          Loading machine resources…
        </p>
        <p v-else-if="!info" class="m-0 text-ui text-danger-text" data-testid="runtime-machine-error">
          {{ resources.error.value }}
        </p>

        <template v-else>
          <p v-if="resources.error.value" class="m-0 text-ui-sm text-warning-text" data-testid="runtime-machine-retained">
            The last update failed; showing the previous reading.
          </p>
          <ul class="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3">
            <li
              v-for="g in gauges"
              :key="g.key"
              class="flex min-w-0 flex-col gap-1.5"
              :data-testid="`runtime-machine-${g.key}`"
              :data-level="g.level"
            >
              <span class="flex items-baseline gap-2">
                <span class="text-label uppercase tracking-wider text-fg-faint">{{ g.label }}</span>
                <span v-if="LEVEL_WORD[g.level]" class="text-label font-semibold" :class="LEVEL_TEXT[g.level]">{{ LEVEL_WORD[g.level] }}</span>
                <span class="ml-auto font-mono text-body font-semibold tabular-nums" :class="LEVEL_TEXT[g.level]">{{ Math.round(g.pct) }}%</span>
              </span>
              <span class="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
                <span
                  class="block h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-standard"
                  :class="LEVEL_BAR[g.level]"
                  :style="{ width: `${Math.min(100, Math.max(0, g.pct))}%` }"
                />
              </span>
              <span class="truncate font-mono text-ui-sm text-fg-mute">{{ g.detail }}</span>
            </li>
          </ul>

          <dl class="m-0 grid grid-cols-2 gap-3 border-t border-line pt-3 md:grid-cols-4" data-testid="runtime-host">
            <div class="min-w-0">
              <dt class="text-label uppercase tracking-wider text-fg-faint">
                Processor
              </dt>
              <dd class="m-0 truncate text-ui-sm text-fg-soft" :title="info.cpu.model">
                {{ info.cpu.model || '—' }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-label uppercase tracking-wider text-fg-faint">
                Load average
              </dt>
              <dd class="m-0 font-mono text-ui-sm tabular-nums text-fg-soft">
                {{ info.loadAvg.map(l => l.toFixed(2)).join('  ') || '—' }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-label uppercase tracking-wider text-fg-faint">
                Uptime
              </dt>
              <dd class="m-0 font-mono text-ui-sm tabular-nums text-fg-soft">
                {{ info.uptime > 0 ? durationLabel(info.uptime) : '—' }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="text-label uppercase tracking-wider text-fg-faint">
                Build
              </dt>
              <dd class="m-0 truncate font-mono text-ui-sm text-fg-soft">
                {{ version || '—' }}
              </dd>
            </div>
          </dl>
        </template>
      </section>
    </div>
  </div>
</template>
