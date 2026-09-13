<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { DataFreshnessIndicator, useLocalMachine } from '@/features/localscope'
import RuntimeTopology from './RuntimeTopology.vue'

/*
 * The runtime context, below the work: a compact summary of this machine, then
 * the runtime topology exactly as it was.
 *
 * The summary reads the shared normalized snapshot only — counts, not lists —
 * so it starts no service or process polling. Those lists are fetched by the
 * topology tree, and only once the user expands it (collapsed by default, and
 * the saved preference is kept).
 *
 * Null is unknown, never zero: a count LocalScope did not measure reads "Not
 * collected", and an absent collector says the counts are unknown.
 */
const props = defineProps<{
  /** Every agent, as the topology has always received them. */
  agents: Agent[]
  /** Live sessions, for the agent count. */
  liveAgentCount: number
}>()

const { snapshot, loaded } = useLocalMachine()

const unavailable = computed(() => loaded.value && snapshot.value.source === 'unavailable')

const rows = computed(() => {
  const c = snapshot.value.counts
  const count = (value: number | null | undefined, unit: string) =>
    value === null || value === undefined ? { value: null, unit } : { value: String(value), unit }
  return [
    { key: 'agents', label: 'Agents', value: String(props.liveAgentCount), unit: 'running' },
    { key: 'services', label: 'Services', ...count(c.services, 'listening') },
    {
      key: 'processes',
      label: 'Processes',
      ...count(c.processesRelevant, c.processesTotal === null || c.processesTotal === undefined ? 'developer' : `of ${c.processesTotal}`),
    },
    { key: 'devices', label: 'Devices', ...count(c.devices, 'connected') },
    { key: 'network', label: 'Network', ...count(c.network, 'connections') },
  ]
})

// Machine rows need a reading; the agent row never does.
const shownRows = computed(() => unavailable.value || !loaded.value ? rows.value.slice(0, 1) : rows.value)
</script>

<template>
  <section
    aria-labelledby="runtime-heading"
    data-testid="command-runtime"
    class="rounded-panel border border-line bg-card px-4 py-3 flex flex-col gap-3 min-w-0"
  >
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id="runtime-heading" class="m-0 text-body font-semibold text-fg">
        Runtime
      </h2>
      <span class="text-ui-sm text-fg-mute">this machine, observed by LocalScope</span>
      <DataFreshnessIndicator v-if="loaded && !unavailable" :reading="snapshot" testid="runtime-freshness" />
    </header>

    <dl class="m-0 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-x-6 gap-y-2" data-testid="runtime-summary">
      <div
        v-for="row in shownRows"
        :key="row.key"
        class="flex flex-col gap-0.5 min-w-0"
        :data-testid="`runtime-summary-${row.key}`"
        :data-state="row.value === null ? 'unknown' : 'measured'"
      >
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          {{ row.label }}
        </dt>
        <dd class="m-0 flex items-baseline text-ui text-fg-soft min-w-0">
          <template v-if="row.value !== null">
            <span class="font-mono tabular-nums font-semibold text-fg">{{ row.value }}</span>
            <span class="text-fg-mute truncate whitespace-pre">{{ ` ${row.unit}` }}</span>
          </template>
          <span v-else class="text-fg-mute">Not collected</span>
        </dd>
      </div>
    </dl>

    <p v-if="!loaded" class="m-0 text-ui-sm text-fg-mute" data-testid="runtime-summary-loading">
      Checking the local runtime…
    </p>
    <p v-else-if="unavailable" class="m-0 text-ui-sm text-fg-mute" data-testid="runtime-summary-unavailable">
      LocalScope is not connected, so machine counts are unknown — not zero.
    </p>

    <RuntimeTopology :agents="agents" />
  </section>
</template>
