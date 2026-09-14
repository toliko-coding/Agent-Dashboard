<script setup lang="ts">
import { computed } from 'vue'
import { DataFreshnessIndicator, formatAge, useLocalMachine } from '@/features/localscope'

/*
 * Where this page's machine data comes from, and whether it is arriving.
 *
 * A statement about one source — LocalScope — and never about the machine or
 * the dashboard as a whole: a live collector is not a healthy system, and an
 * absent one is not a failure of anything the user is running.
 *
 * Reads the shared snapshot, the same 5s reading Command and the sidebar-free
 * surfaces already share, so it adds no request of its own.
 *
 *   connecting   no answer yet — not asked is not absent
 *   live         a current reading (cyan: live observation); a partial one
 *                still says which sources had trouble
 *   stale        the collector stopped answering; the last reading is kept
 *   unavailable  nothing has been observed
 */
const { snapshot, loaded } = useLocalMachine()

type SourceState = 'connecting' | 'live' | 'stale' | 'unavailable'

const state = computed<SourceState>(() => {
  if (!loaded.value)
    return 'connecting'
  if (snapshot.value.source === 'stale')
    return 'stale'
  if (snapshot.value.source === 'unavailable')
    return 'unavailable'
  return 'live'
})

const text = computed(() => {
  switch (state.value) {
    case 'connecting':
      return 'Connecting to LocalScope…'
    case 'live':
      return 'LocalScope live'
    case 'stale': {
      const age = formatAge(snapshot.value.ageMs)
      return age === null
        ? 'LocalScope not responding · showing the last reading'
        : `LocalScope not responding · last reading ${age}`
    }
    default:
      return 'LocalScope not connected'
  }
})

const DOT: Record<SourceState, string> = {
  connecting: 'bg-fg-faint',
  live: 'bg-live-dot',
  stale: 'bg-state-waiting',
  // Hollow: nothing is arriving, and nothing is wrong with what the user runs.
  unavailable: 'border border-fg-mute bg-transparent',
}
</script>

<template>
  <p
    role="status"
    class="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-sm"
    data-testid="runtime-source"
    :data-state="state"
  >
    <span class="size-2 shrink-0 rounded-full" :class="DOT[state]" aria-hidden="true" />
    <span :class="state === 'stale' ? 'text-state-waiting' : 'text-fg-mute'">{{ text }}</span>
    <DataFreshnessIndicator v-if="state === 'live'" :reading="snapshot" testid="runtime-source-freshness" />
  </p>
</template>
