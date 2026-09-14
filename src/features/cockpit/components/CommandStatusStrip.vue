<script setup lang="ts">
import type { AgentFootprint } from '../commandModel'
import type { AttentionQueue } from '@/features/attention'
import { computed } from 'vue'
import { DataFreshnessIndicator, useLocalMachine } from '@/features/localscope'

/*
 * One instrument across the top of Command: the few readings worth taking
 * before anything else, each from data the dashboard already has. Not a row of
 * tiles — one panel of labelled readings, with the counts large enough to read
 * across a room and everything else set small.
 *
 * Motion: the working reading's dot breathes while agents are working and
 * updates are live. Nothing else here moves; a count is not an activity.
 *
 * Connection state appears only when it is news. While agent updates arrive the
 * topbar and sidebar already say so; when they stop, this panel says the numbers
 * beside it are the last ones known.
 */
const props = defineProps<{
  attention: AttentionQueue
  /** Working agents; null before any agent observation. */
  working: number | null
  /** Working agents with an open tool call; null before any agent observation. */
  usingTools?: number | null
  /** Live sessions, finished and internal ones excluded; null before any agent observation. */
  running?: number | null
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
    class="rounded-panel border border-line bg-card px-4 py-3 min-w-0"
  >
    <dl class="m-0 flex flex-wrap items-end gap-x-8 gap-y-3 min-w-0">
      <div class="flex flex-col gap-1" data-testid="status-needs-you" :data-count="needsYou.count ?? undefined">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Needs you
        </dt>
        <dd
          class="m-0 font-mono text-title-lg font-semibold leading-none tabular-nums"
          :class="(needsYou.count ?? 0) > 0 ? 'text-warning-text' : 'text-fg'"
          :aria-label="needsYou.label"
        >
          {{ needsYou.text }}
        </dd>
      </div>

      <div class="flex flex-col gap-1" data-testid="status-working" :data-count="working ?? undefined">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Working
        </dt>
        <dd class="m-0 flex items-center gap-2 font-mono text-title-lg font-semibold leading-none tabular-nums text-fg">
          <span
            v-if="(working ?? 0) > 0"
            class="size-2 rounded-full bg-state-working"
            :class="live ? 'motion-working' : ''"
            data-testid="status-working-dot"
            aria-hidden="true"
          />
          {{ working === null ? '…' : working }}
        </dd>
        <dd v-if="(usingTools ?? 0) > 0" class="m-0 text-ui-sm text-fg-mute" data-testid="status-using-tools">
          {{ usingTools }} using tools
        </dd>
      </div>

      <div v-if="running !== undefined" class="flex flex-col gap-1" data-testid="status-running" :data-count="running ?? undefined">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Running
        </dt>
        <dd class="m-0 flex items-baseline gap-1.5 leading-none">
          <span class="font-mono text-title-lg font-semibold tabular-nums text-fg">{{ running === null ? '…' : running }}</span>{{ ' ' }}
          <span v-if="running !== null" class="text-ui-sm text-fg-mute">{{ running === 1 ? 'session' : 'sessions' }}</span>
        </dd>
      </div>

      <div v-if="footprint" class="flex min-w-0 flex-col gap-1" data-testid="status-footprint">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Agents in
        </dt>
        <dd class="m-0 text-ui text-fg-soft tabular-nums">
          {{ plural(footprint.repositories, 'repository', 'repositories') }} · {{ plural(footprint.workspaces, 'workspace', 'workspaces') }}
        </dd>
      </div>

      <div class="flex min-w-0 flex-col gap-1" data-testid="status-local-runtime" :data-state="localRuntime.state">
        <dt class="text-label uppercase tracking-wider text-fg-faint">
          Local runtime
        </dt>
        <dd class="m-0 flex flex-wrap items-baseline gap-x-2 text-ui text-fg-soft tabular-nums min-w-0">
          <span>{{ localRuntime.text }}</span>
          <DataFreshnessIndicator v-if="localRuntime.state !== 'loading'" :reading="machine" testid="status-local-runtime-freshness" />
        </dd>
      </div>

      <div v-if="!live" class="flex flex-col gap-1 sm:ml-auto" data-testid="status-connection">
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
