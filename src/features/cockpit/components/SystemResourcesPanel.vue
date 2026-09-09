<script setup lang="ts">
import type { PanelState } from '../panelState'
import type { SystemInfo } from '@/composables/useSystemResources'
import { computed } from 'vue'
import { useSystemResources } from '@/composables/useSystemResources'
import CockpitPanel from './CockpitPanel.vue'

/*
 * "System Resources", deliberately NOT "System Health".
 *
 * GET /api/system/health returns a hardcoded status:"ok" that never degrades,
 * so rendering it as a health verdict would be asserting something the server
 * never evaluated. These are the three measurements that are actually taken.
 *
 * The pressure label is derived only from those measurements, using the same
 * 75 / 90 thresholds as the sidebar MachineCard and the status bar's usage bar,
 * so no two surfaces can disagree about what counts as pressure.
 */
const WARN_PCT = 75
const DANGER_PCT = 90

const resources = useSystemResources()
const info = computed<SystemInfo | null>(() => resources.info.value)

const state = computed<PanelState>(() => {
  if (resources.error.value)
    return 'failed'
  return info.value ? 'ready' : 'loading'
})

const metrics = computed(() => {
  const i = info.value
  if (!i)
    return []
  return [
    { key: 'CPU', pct: i.cpu.usage },
    { key: 'Memory', pct: i.memory.usagePercent },
    { key: 'Disk', pct: i.disk.usagePercent },
  ]
})

/**
 * A one-line summary naming the worst measurement, or stating that all three
 * are below the warning threshold. It never claims overall system health —
 * only what these three numbers show.
 */
const summary = computed(() => {
  const worst = [...metrics.value].sort((a, b) => b.pct - a.pct)[0]
  if (!worst)
    return null
  if (worst.pct >= DANGER_PCT)
    return { text: `High ${worst.key.toLowerCase()} usage`, tone: 'text-danger-text' }
  if (worst.pct >= WARN_PCT)
    return { text: `Elevated ${worst.key.toLowerCase()} usage`, tone: 'text-warning-text' }
  return { text: 'All measured resources below 75%', tone: 'text-fg-mute' }
})

function toneClass(pct: number): string {
  if (pct >= DANGER_PCT)
    return 'text-danger-text'
  if (pct >= WARN_PCT)
    return 'text-warning-text'
  return 'text-fg'
}

function barClass(pct: number): string {
  if (pct >= DANGER_PCT)
    return 'bg-danger'
  if (pct >= WARN_PCT)
    return 'bg-warning'
  return 'bg-success'
}
</script>

<template>
  <CockpitPanel
    id="resources"
    title="System Resources"
    :state="state"
    :message="resources.error.value ?? undefined"
  >
    <div class="flex flex-col gap-2" data-testid="system-resources">
      <div v-for="m in metrics" :key="m.key" class="flex items-center gap-2">
        <span class="text-[11px] text-fg-mute w-14 shrink-0">{{ m.key }}</span>
        <span class="flex-1 h-1.5 bg-raised rounded-full overflow-hidden">
          <span
            class="block h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-standard"
            :class="barClass(m.pct)"
            :style="{ width: `${Math.min(100, Math.max(0, m.pct))}%` }"
          />
        </span>
        <span class="text-[11px] font-mono tabular-nums w-10 text-right" :class="toneClass(m.pct)">
          {{ Math.round(m.pct) }}%
        </span>
      </div>

      <p v-if="summary" class="text-[11px]" :class="summary.tone" data-testid="resources-summary">
        {{ summary.text }}
      </p>

      <!-- Named so the absence is visible rather than merely missing. -->
      <p class="text-[10px] text-fg-faint">
        Network throughput not collected yet
      </p>
    </div>
  </CockpitPanel>
</template>
