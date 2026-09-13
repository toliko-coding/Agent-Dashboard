<script setup lang="ts">
import type { SystemInfo } from '../../../composables/useSystemResources'
import { computed } from 'vue'
import { DataFreshnessIndicator, useLocalMachine } from '@/features/localscope'
import AppCard from '../../../components/ui/AppCard.vue'
import { useBuildVersion } from '../../../composables/useBuildVersion'
import { useSystemResources } from '../../../composables/useSystemResources'

/*
 * Host resources come from GET /api/system. The local runtime counts come from
 * the dashboard's normalized LocalScope snapshot — the same lightweight reading,
 * on the same shared poller, that the Overview already uses. No list is fetched
 * here: this view says how many, and detail stays with the Runtime surfaces.
 *
 * Until Phase 3B this view said listening ports, processes and emulators were
 * "Not collected yet". That stopped being true when LocalScope began collecting
 * them, so the page was stating something false about the machine.
 *
 * The rules come from the snapshot model and are not reinterpreted here:
 *   - a number, including 0, is a measurement;
 *   - null means "not collected" and is never rendered as 0;
 *   - an unavailable collector makes every count unknown;
 *   - stale and degraded readings keep their values and say so.
 * Network throughput genuinely is not collected — LocalScope counts active
 * connections, not bytes — so that single gap is still named.
 */
const resources = useSystemResources()
const info = computed<SystemInfo | null>(() => resources.info.value)
const { version } = useBuildVersion()
const { snapshot: machine, loaded: machineLoaded } = useLocalMachine()

const runtimeUnavailable = computed(() => machine.value.source === 'unavailable')

const runtimeRows = computed(() => {
  const c = machine.value.counts
  return [
    { key: 'services', label: 'Listening services', value: c.services, unit: 'listening' },
    {
      key: 'processes',
      label: 'Developer processes',
      value: c.processesRelevant,
      // The denominator is its own measurement; omit it rather than guess.
      unit: c.processesTotal === null ? '' : `of ${c.processesTotal}`,
    },
    { key: 'devices', label: 'Devices', value: c.devices, unit: 'connected' },
    { key: 'network', label: 'Network connections', value: c.network, unit: 'active' },
  ]
})

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
        Local runtime, as counts. Unknown is stated as unknown: an unavailable
        collector is a sentence, and a null count reads "Not collected" — neither
        is ever rendered as 0. Freshness is the snapshot's own qualifier, shown
        once for the whole reading because degradation cannot be attributed to
        a single count.
      -->
      <AppCard data-testid="system-runtime">
        <template #header>
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="text-[11px] uppercase tracking-wider text-fg-mute font-bold">Local runtime</span>
            <span class="text-[11px] text-fg-faint">observed by LocalScope</span>
            <DataFreshnessIndicator :reading="machine" testid="system-runtime-freshness" />
          </div>
        </template>

        <p v-if="!machineLoaded" class="p-3 text-[12px] text-fg-mute" data-testid="system-runtime-connecting">
          Connecting to LocalScope…
        </p>
        <p v-else-if="runtimeUnavailable" class="p-3 text-[12px] text-fg-mute" data-testid="system-runtime-unavailable">
          LocalScope is not connected, so these counts are unknown — not zero.
        </p>
        <dl v-else class="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
          <div
            v-for="row in runtimeRows"
            :key="row.key"
            :data-testid="`system-runtime-${row.key}`"
            :data-state="row.value === null ? 'unknown' : 'measured'"
          >
            <dt class="text-[10px] text-fg-faint uppercase tracking-wide">
              {{ row.label }}
            </dt>
            <dd v-if="row.value === null" class="text-fg-faint">
              Not collected
            </dd>
            <!--
              A flex gap, not a literal space: the template compiler condenses
              whitespace between elements, which rendered "8listening".
            -->
            <dd v-else class="flex items-baseline gap-1 text-fg-soft">
              <span class="font-mono tabular-nums">{{ row.value }}</span>
              <span v-if="row.unit" class="text-fg-faint">{{ row.unit }}</span>
            </dd>
          </div>
        </dl>

        <p class="px-3 pb-3 text-[11px] text-fg-faint" data-testid="system-runtime-throughput">
          Network throughput is not collected.
        </p>
      </AppCard>
    </template>
  </section>
</template>
