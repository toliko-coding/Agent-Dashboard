<script setup lang="ts">
import type { PanelState } from '../panelState'
import type { SystemInfo } from '@/composables/useSystemResources'
import { computed } from 'vue'
import { useSystemResources } from '@/composables/useSystemResources'
import { barWidth, RESOURCE_LEVEL_BAR, RESOURCE_LEVEL_TEXT, RESOURCE_LEVEL_WORD, resourceLevel } from '@/utils/resourceLevel'
import CockpitPanel from './CockpitPanel.vue'

/*
 * This machine, compactly: CPU, memory and disk as GET /api/system reports them
 * — measured by the dashboard server itself, not by LocalScope, and labelled so.
 *
 * It reads the shared, ref-counted poller the sidebar and status bar already
 * run (useSystemResources), so it adds no request. Load average is shown as the
 * number it is; there is no network figure because none is measured. The disk's
 * mount point is a path and stays off this page.
 *
 * The full reading, with processor, uptime and build, is Runtime's Overview.
 */
const emit = defineEmits<{ openRuntime: [] }>()

const resources = useSystemResources()
const info = computed<SystemInfo | null>(() => resources.info.value)
const error = computed(() => resources.error.value)

const state = computed<PanelState>(() => {
  if (info.value)
    return 'ready'
  return error.value ? 'failed' : 'loading'
})

const GIB = 1024 ** 3
const gib = (bytes: number) => `${(bytes / GIB).toFixed(1)} GiB`

const gauges = computed(() => {
  const i = info.value
  if (!i)
    return []
  return [
    { key: 'cpu', label: 'CPU', pct: i.cpu.usage, detail: `${i.cpu.cores} cores` },
    { key: 'memory', label: 'Memory', pct: i.memory.usagePercent, detail: `${gib(i.memory.used)} of ${gib(i.memory.total)}` },
    { key: 'disk', label: 'Disk', pct: i.disk.usagePercent, detail: `${gib(i.disk.used)} of ${gib(i.disk.total)}` },
  ].map(g => ({ ...g, level: resourceLevel(g.pct) }))
})

const load = computed(() => info.value?.loadAvg?.length ? info.value.loadAvg.map(l => l.toFixed(2)).join('  ') : null)
</script>

<template>
  <CockpitPanel id="machine" title="This machine" :state="state" :message="error ?? undefined">
    <template #action>
      <button
        type="button"
        class="cursor-pointer rounded-control border-none bg-transparent p-0 text-ui-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        data-testid="machine-open-runtime"
        @click="emit('openRuntime')"
      >
        Open Runtime
      </button>
    </template>

    <div class="flex flex-col gap-2.5">
      <p v-if="error" class="m-0 text-ui-sm text-warning-text" data-testid="machine-retained">
        The last update failed; showing the previous reading.
      </p>
      <ul class="m-0 flex list-none flex-col gap-2 p-0">
        <li
          v-for="g in gauges"
          :key="g.key"
          class="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5"
          :data-testid="`machine-${g.key}`"
          :data-level="g.level"
        >
          <span class="text-label uppercase tracking-wider text-fg-faint">{{ g.label }}</span>{{ ' ' }}
          <span class="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
            <span
              class="block h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-standard"
              :class="RESOURCE_LEVEL_BAR[g.level]"
              :style="{ width: barWidth(g.pct) }"
            />
          </span>
          <span class="flex items-baseline justify-end gap-1.5">
            <span v-if="RESOURCE_LEVEL_WORD[g.level]" class="text-label font-semibold" :class="RESOURCE_LEVEL_TEXT[g.level]">{{ RESOURCE_LEVEL_WORD[g.level] }}</span>{{ ' ' }}
            <span class="w-10 text-right font-mono text-ui font-semibold tabular-nums" :class="RESOURCE_LEVEL_TEXT[g.level]">{{ Math.round(g.pct) }}%</span>
          </span>
          <span class="col-start-2 col-span-2 truncate font-mono text-label text-fg-mute">{{ g.detail }}</span>
        </li>
      </ul>
      <p class="m-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line pt-2 text-label text-fg-faint">
        <span v-if="load" data-testid="machine-load">Load <span class="font-mono tabular-nums text-fg-mute">{{ load }}</span></span>{{ ' ' }}
        <span>Measured by the dashboard server</span>
      </p>
    </div>
  </CockpitPanel>
</template>
