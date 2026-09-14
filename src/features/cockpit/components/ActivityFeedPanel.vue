<script setup lang="ts">
import type { PanelState } from '../panelState'
import type { ActivityEvent, ActivitySeverity } from '@/utils/activityEvents'
import { computed } from 'vue'
import { useActivityFeed } from '@/composables/useActivityFeed'
import { useNow } from '@/composables/useNow'
import { formatRelativeActivity, secondsSince } from '@/utils/format'
import CockpitPanel from './CockpitPanel.vue'

/*
 * Real server-authored events only — see the header of utils/activityEvents.ts
 * for which sources were considered and why the audit log is the only one used.
 *
 * Each event is what happened, who did it and when: its severity as a mark and
 * a word (never colour alone), the actor the server recorded, and a relative
 * time with the clock time in its tooltip. An event that belongs to a task
 * opens that task. The audit target (task:<id>, pid:<n>) is an internal
 * identifier, not something Command shows; the event's own surface carries it.
 */
const props = withDefaults(defineProps<{ limit?: number }>(), { limit: 8 })
const emit = defineEmits<{ openTask: [taskId: string] }>()

const { events, isLoading, loaded, error } = useActivityFeed()
// The shared 30s clock the other relative times on the page use.
const { nowMs } = useNow()

const state = computed<PanelState>(() => {
  if (error.value)
    return 'failed'
  if (isLoading.value && !loaded.value)
    return 'loading'
  return events.value.length === 0 ? 'empty' : 'ready'
})

const shown = computed(() => events.value.slice(0, props.limit))

const SEVERITY: Record<ActivitySeverity, { mark: string, tone: string, word: string }> = {
  info: { mark: '•', tone: 'text-info-text border-info-line', word: 'information' },
  success: { mark: '✓', tone: 'text-success-text border-success-line', word: 'succeeded' },
  warning: { mark: '!', tone: 'text-warning-text border-warning-line', word: 'warning' },
  danger: { mark: '✕', tone: 'text-danger-text border-danger-line', word: 'refused' },
}

const ACTOR: Record<string, string> = {
  user: 'You',
  agent: 'An agent',
  orchestrator: 'Orchestrator',
  system: 'System',
}

function actorWord(actor: string): string {
  if (ACTOR[actor])
    return ACTOR[actor]
  return actor ? actor.charAt(0).toUpperCase() + actor.slice(1) : 'System'
}

const DAY_S = 86_400

function when(e: ActivityEvent): string {
  if (Number.isNaN(e.timestamp))
    return 'time unknown'
  const seconds = secondsSince(e.timestampRaw, nowMs.value)
  if (seconds !== null && seconds >= DAY_S)
    return new Date(e.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return formatRelativeActivity(seconds)
}

function clockTime(e: ActivityEvent): string {
  if (Number.isNaN(e.timestamp))
    return ''
  return new Date(e.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <CockpitPanel
    id="activity"
    title="Recent activity"
    :state="state"
    :message="error ?? 'No recorded activity yet. Agent spawns, messages to agents, permission decisions and task changes appear here.'"
  >
    <template #action>
      <span class="text-label text-fg-faint">from the audit log</span>
    </template>

    <ol class="m-0 flex list-none flex-col p-0" data-testid="activity-feed">
      <li
        v-for="(e, index) in shown"
        :key="e.id"
        class="flex min-w-0 gap-2.5"
        :data-testid="`activity-${e.action}`"
        :data-severity="e.severity"
      >
        <!-- The timeline: one mark per event, joined to the next. -->
        <span class="flex shrink-0 flex-col items-center" aria-hidden="true">
          <span
            class="flex size-5 items-center justify-center rounded-full border bg-card text-label font-semibold leading-none"
            :class="SEVERITY[e.severity].tone"
          >{{ SEVERITY[e.severity].mark }}</span>
          <span v-if="index < shown.length - 1" class="my-0.5 w-px flex-1 bg-line" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5" :class="index < shown.length - 1 ? 'pb-2.5' : ''">
          <button
            v-if="e.taskId"
            type="button"
            class="min-w-0 cursor-pointer truncate rounded-control border-none bg-transparent p-0 text-left text-ui text-fg hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            data-testid="activity-open-task"
            @click="emit('openTask', e.taskId)"
          >
            {{ e.title }}<span class="sr-only">, {{ SEVERITY[e.severity].word }}. Open task</span>
          </button>
          <span v-else class="min-w-0 truncate text-ui text-fg">
            {{ e.title }}<span class="sr-only">, {{ SEVERITY[e.severity].word }}</span>
          </span>
          <span class="flex min-w-0 items-baseline gap-1.5 text-label text-fg-mute">
            <span class="truncate" data-testid="activity-actor">{{ actorWord(e.actor) }}</span>{{ ' ' }}
            <span aria-hidden="true">·</span>{{ ' ' }}
            <time class="shrink-0 tabular-nums" :datetime="e.timestampRaw" :title="clockTime(e)" data-testid="activity-when">{{ when(e) }}</time>
          </span>
        </span>
      </li>
    </ol>
  </CockpitPanel>
</template>
