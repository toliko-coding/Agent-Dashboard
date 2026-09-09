<script setup lang="ts">
import type { SystemInfo } from '../../../composables/useSystemResources'
import { computed } from 'vue'
import AppCard from '../../../components/ui/AppCard.vue'
import { useBuildVersion } from '../../../composables/useBuildVersion'
import { useSystemResources } from '../../../composables/useSystemResources'

/*
 * Everything here comes from GET /api/system, which is real. Deliberately NOT
 * shown, because the collector does not provide them: network throughput,
 * listening ports, processes and emulators. Those belong to LocalScope and are
 * absent rather than zeroed.
 */
const resources = useSystemResources()
const info = computed<SystemInfo | null>(() => resources.info.value)
const { version } = useBuildVersion()

function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0)
    return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

const WARN_PCT = 75
const DANGER_PCT = 90

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

const gauges = computed(() => {
  const i = info.value
  if (!i)
    return []
  return [
    { key: 'CPU', pct: i.cpu.usage, detail: `${i.cpu.cores} cores` },
    { key: 'Memory', pct: i.memory.usagePercent, detail: `${gib(i.memory.used)} / ${gib(i.memory.total)}` },
    { key: 'Disk', pct: i.disk.usagePercent, detail: `${gib(i.disk.used)} / ${gib(i.disk.total)} · ${i.disk.mount}` },
  ]
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <p v-if="!info && !resources.error.value" class="text-[13px] text-fg-mute">
      Loading system information…
    </p>
    <p v-else-if="resources.error.value" class="text-[13px] text-danger-text">
      {{ resources.error.value }}
    </p>

    <template v-else-if="info">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <AppCard v-for="g in gauges" :key="g.key">
          <div class="p-3 flex flex-col gap-2">
            <div class="flex items-baseline gap-2">
              <span class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">{{ g.key }}</span>
              <span class="ml-auto text-[17px] font-mono tabular-nums font-semibold" :class="toneClass(g.pct)">
                {{ Math.round(g.pct) }}%
              </span>
            </div>
            <span class="h-1.5 bg-raised rounded-full overflow-hidden">
              <span
                class="block h-full rounded-full transition-[width] duration-[var(--duration-base)] ease-standard"
                :class="barClass(g.pct)"
                :style="{ width: `${Math.min(100, Math.max(0, g.pct))}%` }"
              />
            </span>
            <span class="text-[10px] font-mono text-fg-faint truncate" :title="g.detail">{{ g.detail }}</span>
          </div>
        </AppCard>
      </div>

      <AppCard>
        <template #header>
          <span class="text-[11px] uppercase tracking-wider text-fg-mute font-bold">Host</span>
        </template>
        <dl class="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px] font-mono">
          <div>
            <dt class="text-[10px] text-fg-faint uppercase tracking-wide">
              Processor
            </dt>
            <dd class="text-fg-soft truncate" :title="info.cpu.model">
              {{ info.cpu.model || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] text-fg-faint uppercase tracking-wide">
              Load avg
            </dt>
            <dd class="text-fg-soft tabular-nums">
              {{ info.loadAvg.map(l => l.toFixed(2)).join('  ') || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] text-fg-faint uppercase tracking-wide">
              Uptime
            </dt>
            <dd class="text-fg-soft tabular-nums">
              {{ formatUptime(info.uptime) }}
            </dd>
          </div>
          <div>
            <dt class="text-[10px] text-fg-faint uppercase tracking-wide">
              Build
            </dt>
            <dd class="text-fg-soft truncate">
              {{ version || '—' }}
            </dd>
          </div>
        </dl>
      </AppCard>

      <!--
        Named explicitly so the gap is visible rather than silently missing.
        These become real when a LocalScope collector exists.
      -->
      <AppCard>
        <template #header>
          <span class="text-[11px] uppercase tracking-wider text-fg-mute font-bold">Not collected yet</span>
        </template>
        <ul class="p-3 flex flex-wrap gap-2 text-[11px] text-fg-faint">
          <li v-for="item in ['Network throughput', 'Listening ports', 'Processes', 'Emulators']" :key="item" class="border border-line rounded px-2 py-1 opacity-70">
            {{ item }} — n/a
          </li>
        </ul>
      </AppCard>
    </template>
  </section>
</template>
