<script setup lang="ts">
import type { SystemInfo } from '../../composables/useSystemResources'
import { computed } from 'vue'
import { useSystemResources } from '../../composables/useSystemResources'
import { RESOURCE_LEVEL_BAR, resourceLevel } from '../../utils/resourceLevel'

defineProps<{ expanded: boolean }>()

const resources = useSystemResources()
// Read .value explicitly so this works with a real Ref<SystemInfo> and with the
// plain { value } object the shell tests hand back from their mock.
const info = computed<SystemInfo | null>(() => resources.info.value)

/*
 * Levels come from utils/resourceLevel, shared with Command's This machine, the
 * Runtime Overview and the status bar, so no two surfaces disagree about what
 * counts as pressure. A normal reading is neutral: a green bar would claim the
 * machine is healthy when it is only measured.
 */
function toneClass(pct: number): string {
  const level = resourceLevel(pct)
  if (level === 'critical')
    return 'text-danger-text'
  return level === 'high' ? 'text-warning-text' : 'text-fg-soft'
}

function barClass(pct: number): string {
  return RESOURCE_LEVEL_BAR[resourceLevel(pct)]
}

/*
 * The API reports one mount (the home directory) and a CPU model string; there
 * is no machine-name field, so the model doubles as the machine label rather
 * than inventing a hostname. Falls back to a neutral label, never a fake name.
 */
const machineLabel = computed(() => info.value?.cpu.model?.trim() || 'Local machine')

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
</script>

<template>
  <div
    v-if="expanded"
    class="mt-2 pt-2 border-t border-line"
    data-testid="machine-card"
  >
    <div class="px-1.5 pb-1.5 text-[9px] uppercase tracking-wider text-fg-faint font-bold">
      Local machine
    </div>

    <div class="px-1.5 pb-1 text-[10px] text-fg-mute font-mono truncate" :title="machineLabel">
      {{ machineLabel }}
    </div>

    <div v-if="metrics.length" class="flex flex-col gap-1 px-1.5 pb-1.5">
      <div v-for="m in metrics" :key="m.key" class="flex items-center gap-2">
        <span class="text-[10px] text-fg-faint w-12 shrink-0">{{ m.key }}</span>
        <span class="flex-1 h-1 bg-raised rounded-full overflow-hidden">
          <span
            class="block h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-standard"
            :class="barClass(m.pct)"
            :style="{ width: `${Math.min(100, Math.max(0, m.pct))}%` }"
          />
        </span>
        <span class="text-[10px] font-mono tabular-nums w-9 text-right" :class="toneClass(m.pct)">
          {{ Math.round(m.pct) }}%
        </span>
      </div>

      <!--
        Network has no backing collector (SystemInfo carries no network field),
        so it is shown as explicitly unavailable rather than as 0 — a zero here
        would read as "measured, and idle". When a collector lands this row
        becomes a real metric with no layout change.
      -->
      <div class="flex items-center gap-2" data-testid="machine-network-unavailable">
        <span class="text-[10px] text-fg-faint w-12 shrink-0">Network</span>
        <span class="flex-1 text-[10px] text-fg-faint font-mono">—</span>
        <span class="text-[9px] text-fg-faint">n/a</span>
      </div>
    </div>

    <div v-else class="px-1.5 pb-1.5 text-[10px] text-fg-faint font-mono">
      —
      <span class="ml-1">loading…</span>
    </div>
  </div>
</template>
