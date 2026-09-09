<script setup lang="ts">
import type { PanelState } from '../panelState'
import type { ActivitySeverity } from '@/utils/activityEvents'
import { computed } from 'vue'
import { useActivityFeed } from '@/composables/useActivityFeed'
import CockpitPanel from './CockpitPanel.vue'

/*
 * Real server-authored events only — see the header of utils/activityEvents.ts
 * for which sources were considered and why the audit log is the only one used.
 */
const props = withDefaults(defineProps<{ limit?: number }>(), { limit: 8 })

const { events, isLoading, loaded, error } = useActivityFeed()

const state = computed<PanelState>(() => {
  if (error.value)
    return 'failed'
  if (isLoading.value && !loaded.value)
    return 'loading'
  return events.value.length === 0 ? 'empty' : 'ready'
})

const shown = computed(() => events.value.slice(0, props.limit))

const DOT: Record<ActivitySeverity, string> = {
  info: 'bg-info-dot',
  success: 'bg-success-dot',
  warning: 'bg-warning-dot',
  danger: 'bg-danger-dot',
}

function clockTime(raw: string): string {
  const ms = Date.parse(raw)
  if (Number.isNaN(ms))
    return '--:--'
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <CockpitPanel
    id="activity"
    title="Activity"
    :state="state"
    :message="error ?? 'No recorded activity yet.'"
  >
    <ul class="flex flex-col gap-1.5" data-testid="activity-feed">
      <li
        v-for="e in shown"
        :key="e.id"
        class="flex items-baseline gap-2 text-[12px] min-w-0"
        :data-testid="`activity-${e.action}`"
      >
        <time
          class="font-mono text-[10px] text-fg-faint tabular-nums shrink-0"
          :datetime="e.timestampRaw"
        >{{ clockTime(e.timestampRaw) }}</time>
        <span class="size-1.5 rounded-full shrink-0 translate-y-[-1px]" :class="DOT[e.severity]" aria-hidden="true" />
        <span class="text-fg truncate">{{ e.title }}</span>
        <span v-if="e.detail" class="ml-auto font-mono text-[10px] text-fg-faint truncate shrink-0" :title="e.detail">
          {{ e.detail }}
        </span>
      </li>
    </ul>
  </CockpitPanel>
</template>
