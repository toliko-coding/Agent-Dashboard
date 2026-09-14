<script setup lang="ts">
import type { AgentFootprint } from '../commandModel'
import type { AttentionQueue } from '@/features/attention'
import { computed } from 'vue'
import { DataFreshnessIndicator, useLocalMachine } from '@/features/localscope'

/*
 * Command's instruments (3N.2): a row of readings, each a small lit panel with
 * its mark, its number and what the number is — from data the dashboard already
 * has. Null is never drawn as zero: an unknown reading shows "…" or says why.
 *
 * Motion: only the working reading's dot breathes, and only while agents work
 * and updates are live. A count is not an activity.
 *
 * Connection state appears only when it is news; the hero and topbar already
 * say when updates are live.
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

const TILE = 'cc-instrument flex min-w-0 flex-col gap-1.5 rounded-xl border border-line px-4 py-3'
const DT = 'flex items-center gap-2 text-label uppercase tracking-wider text-fg-faint'
const MARK = 'inline-flex size-6 shrink-0 items-center justify-center rounded-lg border border-line bg-raised/60 text-fg-soft'
</script>

<template>
  <section aria-label="Command status" data-testid="command-status" class="min-w-0">
    <dl class="m-0 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
      <div :class="TILE" data-testid="status-running" :data-count="running ?? undefined">
        <dt :class="DT">
          <span :class="MARK" aria-hidden="true"><svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 5.5h8v7H4zM8 3v2.5M6.5 8.5h.01M9.5 8.5h.01" stroke-linecap="round" /></svg></span>
          Agents
        </dt>
        <dd class="m-0 flex items-baseline gap-1.5 leading-none">
          <span class="font-mono text-title-lg font-semibold tabular-nums text-fg">{{ running === null || running === undefined ? '…' : running }}</span>{{ ' ' }}
          <span v-if="running !== null && running !== undefined" class="text-ui-sm text-fg-mute">{{ running === 1 ? 'session' : 'sessions' }}</span>
        </dd>
      </div>

      <div :class="[TILE, (working ?? 0) > 0 ? 'cc-instrument-live' : '']" data-testid="status-working" :data-count="working ?? undefined">
        <dt :class="DT">
          <span :class="MARK" aria-hidden="true"><svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.5 8h2.5l1.5-4 3 8 1.5-4h2.5" /></svg></span>
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

      <div :class="[TILE, (needsYou.count ?? 0) > 0 ? 'cc-instrument-attention' : '']" data-testid="status-needs-you" :data-count="needsYou.count ?? undefined">
        <dt :class="DT">
          <span :class="MARK" aria-hidden="true"><svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 2.5l6 11H2z M8 6.5v3.2M8 11.6h.01" /></svg></span>
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

      <div v-if="footprint" :class="TILE" data-testid="status-footprint">
        <dt :class="DT">
          <span :class="MARK" aria-hidden="true"><svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5 3v7M5 10a2 2 0 1 0 0 3.5M11 6a2 2 0 1 0 0-3.5A2 2 0 0 0 11 6zM11 6c0 3-6 2-6 4" /></svg></span>
          Agents in
        </dt>
        <dd class="m-0 text-ui text-fg-soft tabular-nums">
          {{ plural(footprint.repositories, 'repository', 'repositories') }} · {{ plural(footprint.workspaces, 'workspace', 'workspaces') }}
        </dd>
      </div>

      <div :class="TILE" data-testid="status-local-runtime" :data-state="localRuntime.state">
        <dt :class="DT">
          <span :class="MARK" aria-hidden="true"><svg viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 3.5h10v4H3zM3 9.5h10v3.5H3zM5.5 5.5h.01M5.5 11.2h.01" /></svg></span>
          Local runtime
        </dt>
        <dd class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui text-fg-soft tabular-nums">
          <span>{{ localRuntime.text }}</span>
          <DataFreshnessIndicator v-if="localRuntime.state !== 'loading'" :reading="machine" testid="status-local-runtime-freshness" />
        </dd>
      </div>

      <div v-if="!live" class="flex flex-col justify-center gap-1 col-span-full xl:col-span-1" data-testid="status-connection">
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
