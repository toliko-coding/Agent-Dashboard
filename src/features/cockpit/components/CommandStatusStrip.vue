<script setup lang="ts">
import type { AgentFootprint } from '../commandModel'
import type { AttentionQueue } from '@/features/attention'
import { computed } from 'vue'
import { DataFreshnessIndicator, useLocalMachine } from '@/features/localscope'

/*
 * One instrument across the top of Command: the few facts worth reading before
 * anything else, each from data the dashboard already has. Not a row of tiles —
 * a single line of labelled readings.
 *
 * Connection state appears only when it is news. While agent updates arrive the
 * topbar and sidebar already say so; when they stop, this line says the numbers
 * beside it are the last ones known.
 */
const props = defineProps<{
  attention: AttentionQueue
  /** Working agents; null before any agent observation. */
  working: number | null
  footprint: AgentFootprint | null
  live: boolean
}>()

// The same shared snapshot poller the runtime summary reads; this opens nothing new.
const { snapshot: machine, loaded: machineLoaded } = useLocalMachine()

const needsYou = computed(() => {
  if (props.attention.status === 'loading')
    return { text: '…', label: 'checking', count: null }
  if (props.attention.status === 'unavailable')
    return { text: 'unknown', label: 'unknown', count: null }
  return { text: String(props.attention.items.length), label: String(props.attention.items.length), count: props.attention.items.length }
})

const localRuntime = computed(() => {
  if (!machineLoaded.value)
    return { text: '…', state: 'loading' }
  if (machine.value.source === 'unavailable')
    return { text: 'not connected', state: 'unavailable' }
  const services = machine.value.counts.services
  if (services === null || services === undefined)
    return { text: 'services not collected', state: 'unknown' }
  return { text: `${services} ${services === 1 ? 'service' : 'services'} listening`, state: 'measured' }
})

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
</script>

<template>
  <section
    aria-label="Command status"
    data-testid="command-status"
    class="rounded-panel border border-line bg-card px-4 py-2.5 min-w-0"
  >
    <dl class="m-0 flex flex-wrap items-baseline gap-x-6 gap-y-2 min-w-0">
      <div class="flex items-baseline gap-2" data-testid="status-needs-you" :data-count="needsYou.count ?? undefined">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Needs you
        </dt>
        <dd
          class="m-0 text-ui font-semibold tabular-nums"
          :class="(needsYou.count ?? 0) > 0 ? 'text-warning-text' : 'text-fg'"
          :aria-label="needsYou.label"
        >
          {{ needsYou.text }}
        </dd>
      </div>

      <div class="flex items-baseline gap-2" data-testid="status-working" :data-count="working ?? undefined">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Working
        </dt>
        <dd class="m-0 flex items-center gap-1.5 text-ui font-semibold tabular-nums text-fg">
          <span
            v-if="(working ?? 0) > 0"
            class="size-1.5 rounded-full bg-state-working"
            aria-hidden="true"
          />
          {{ working === null ? '…' : working }}
        </dd>
      </div>

      <div v-if="footprint" class="flex items-baseline gap-2" data-testid="status-footprint">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Agents in
        </dt>
        <dd class="m-0 text-ui text-fg-soft tabular-nums">
          {{ plural(footprint.repositories, 'repository', 'repositories') }} · {{ plural(footprint.workspaces, 'workspace', 'workspaces') }}
        </dd>
      </div>

      <div class="flex items-baseline gap-2 min-w-0" data-testid="status-local-runtime" :data-state="localRuntime.state">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Local runtime
        </dt>
        <dd class="m-0 flex flex-wrap items-baseline gap-x-2 text-ui text-fg-soft tabular-nums min-w-0">
          <span>{{ localRuntime.text }}</span>
          <DataFreshnessIndicator v-if="localRuntime.state !== 'loading'" :reading="machine" testid="status-local-runtime-freshness" />
        </dd>
      </div>

      <div v-if="!live" class="flex items-baseline gap-2 sm:ml-auto" data-testid="status-connection">
        <dt class="sr-only">
          Agent updates
        </dt>
        <dd class="m-0 flex items-center gap-1.5 text-ui-sm text-warning-text">
          <span class="size-1.5 rounded-full bg-warning" aria-hidden="true" />
          Agent updates reconnecting · last known state
        </dd>
      </div>
    </dl>
  </section>
</template>
