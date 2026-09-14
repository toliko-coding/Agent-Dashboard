<script setup lang="ts">
import { computed } from 'vue'
import { DataFreshnessIndicator, useMachineDevices } from '@/features/localscope'

/*
 * Emulators, simulators and physical devices.
 *
 * Devices have a state the other lists do not: `connected` is the count only
 * when every adapter ran. When one could not (no adb on PATH), the list beside
 * it is not a measurement, so "zero devices" and "could not look" must read
 * differently:
 *
 *   loading          no answer yet
 *   unknown          no list at all — LocalScope has not reported one
 *   adapters-failed  an empty list from adapters that did not all run
 *   incomplete       devices were found, but an adapter did not run
 *   measured         a real count, 0 included
 *
 * A partial adapter (uninstalled simulator runtimes) still ran, so its devices
 * are counted. A stale list keeps its rows and says it is stale.
 */
const { data, loaded } = useMachineDevices()

const items = computed(() => Array.isArray(data.value.items) ? data.value.items : null)
const connected = computed(() => data.value.connected)

/** The adapters that could not run, in the collector's own words. */
const failedAdapters = computed(() =>
  data.value.degraded.filter(d => d.kind !== 'partial').map(d => d.source).join(', '))

type DeviceState = 'loading' | 'unknown' | 'adapters-failed' | 'incomplete' | 'measured'
const state = computed<DeviceState>(() => {
  if (!loaded.value && items.value === null)
    return 'loading'
  if (items.value === null)
    return 'unknown'
  if (connected.value === null)
    return items.value.length === 0 ? 'adapters-failed' : 'incomplete'
  return 'measured'
})

function stateTone(deviceState: string): { dot: string, text: string } {
  if (deviceState === 'online')
    return { dot: 'bg-state-success', text: 'text-success-text' }
  if (deviceState === 'unauthorized' || deviceState === 'unavailable')
    return { dot: 'bg-state-waiting', text: 'text-warning-text' }
  return { dot: 'bg-state-idle', text: 'text-fg-mute' }
}
</script>

<template>
  <section aria-labelledby="runtime-devices-heading" class="flex min-w-0 flex-col gap-3" data-testid="runtime-devices" :data-state="state">
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id="runtime-devices-heading" class="m-0 text-title font-semibold text-fg">
        Devices
      </h2>
      <span v-if="connected !== null" class="font-mono text-ui-sm tabular-nums text-fg-mute" data-testid="devices-count">{{ connected }} connected</span>
      <DataFreshnessIndicator :reading="data" testid="devices-freshness" />
    </header>

    <p v-if="state === 'loading'" class="m-0 text-ui text-fg-mute" data-testid="devices-loading">
      Loading devices…
    </p>
    <p v-else-if="state === 'unknown'" class="m-0 text-ui text-fg-mute" data-testid="devices-unknown">
      Device list unavailable — LocalScope has not reported one. This is not the same as zero devices.
    </p>
    <p v-else-if="state === 'adapters-failed'" class="m-0 text-ui text-fg-mute" data-testid="devices-unavailable">
      Not every device adapter could run{{ failedAdapters ? ` (${failedAdapters})` : '' }}, so there is no device count — Android requires adb on PATH.
      This is not the same as zero devices.
    </p>
    <p v-else-if="state === 'measured' && items && items.length === 0" class="m-0 text-ui text-fg-mute" data-testid="devices-none">
      No devices or emulators connected.
    </p>

    <template v-if="items && items.length > 0">
      <p v-if="state === 'incomplete'" class="m-0 text-ui-sm text-fg-mute" data-testid="devices-incomplete">
        Not every device adapter could run{{ failedAdapters ? ` (${failedAdapters})` : '' }}, so this list may be incomplete.
      </p>
      <ul class="m-0 list-none divide-y divide-line overflow-hidden rounded-panel border border-line bg-card p-0" data-testid="devices-list">
        <li
          v-for="d in items"
          :key="d.id"
          class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5"
          data-testid="device-row"
        >
          <div class="flex min-w-0 flex-col">
            <span class="truncate text-ui font-semibold text-fg">{{ d.model ?? d.serial }}</span>
            <span class="truncate font-mono text-ui-sm text-fg-mute">{{ d.platform }} · {{ d.form }}<template v-if="d.osVersion"> · {{ d.osVersion }}</template></span>
          </div>
          <span class="flex items-center gap-1.5 text-ui-sm" data-testid="device-state">
            <span class="size-2 shrink-0 rounded-full" :class="stateTone(d.state).dot" aria-hidden="true" />
            <span :class="stateTone(d.state).text">{{ d.state }}</span>
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
