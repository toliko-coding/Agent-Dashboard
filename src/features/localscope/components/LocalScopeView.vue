<script setup lang="ts">
import type { MachineProcess } from '../snapshot'
import type { DevProcess } from '../types'
import { computed, ref } from 'vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import ViewPlaceholder from '@/components/ViewPlaceholder.vue'
import { localScopeClient } from '../client'
import { useLocalMachine } from '../composables/useLocalMachine'
import { useMachineDevices, useMachineProcesses, useMachineServices } from '../composables/useMachineLists'
import { formatAge, freshnessNote } from '../snapshot'
import { relevanceLabel } from '../types'
import ServiceCard from './ServiceCard.vue'

/*
 * The LocalScope page. This app is a CONSUMER: every number here was collected,
 * classified and correlated by LocalScope. No ps/lsof/adb parsing, no process
 * classification and no project correlation is repeated on this side.
 *
 * Every section reads a dashboard-owned normalized model. The collector's own
 * envelope reaches exactly one thing on this page — the `all=true` opt-in
 * below, which has no normalized endpoint by design.
 */
const machine = useLocalMachine()
const services = useMachineServices()
const processes = useMachineProcesses()
const devices = useMachineDevices()

/*
 * A list is KNOWN only when the collector actually produced one. `items: null`
 * means we do not know it — an unreachable collector says nothing about the
 * machine — while `[]` means the collector looked and found none. The page must
 * not render the first as the second.
 */
const serviceItems = computed(() => services.data.value.items)
const processItems = computed(() => processes.data.value.items)
const deviceItems = computed(() => devices.data.value.items)

const servicesNote = computed(() => freshnessNote(services.data.value))
const processesNote = computed(() => freshnessNote(processes.data.value))
const devicesNote = computed(() => freshnessNote(devices.data.value))

/*
 * The page banner, on the same four states as everything else.
 *
 * `stale` is deliberately NOT the same page state as "start the collector".
 * A collector that has gone away leaves behind a reading that was true minutes
 * ago; hiding it would replace "I cannot see this machine right now" with "this
 * machine has nothing on it", which is the failure this whole model exists to
 * prevent. Only a page that has never observed anything shows the placeholder.
 */
const machineSource = computed(() => machine.snapshot.value.source)

const neverObserved = computed(() =>
  machineSource.value === 'unavailable'
  && services.data.value.source === 'unavailable'
  && processes.data.value.source === 'unavailable'
  && devices.data.value.source === 'unavailable')

/*
 * "Not asked yet" is not "not running". The placeholder waits for the first
 * response so a page opened on a healthy machine never flashes it.
 */
const anyLoaded = computed(() =>
  machine.loaded.value || services.loaded.value || processes.loaded.value || devices.loaded.value)

const banner = computed<{ tone: 'stale' | 'degraded', text: string } | null>(() => {
  if (machineSource.value === 'stale') {
    const age = formatAge(machine.snapshot.value.ageMs)
    return {
      tone: 'stale',
      text: age === null
        ? 'LocalScope is not responding. Showing the last reading.'
        : `LocalScope is not responding. Showing the last reading, collected ${age}.`,
    }
  }
  if (machineSource.value === 'degraded') {
    const sources = machine.snapshot.value.degraded.map(d => d.source).join(', ')
    return { tone: 'degraded', text: `LocalScope is connected, with reduced data from: ${sources}.` }
  }
  return null
})

/*
 * LocalScope filters hundreds of macOS processes down to the developer-relevant
 * ones. That filtering is the product, so it stays the default; "all" is an
 * explicit opt-in fetched on demand rather than a second poller.
 */
const showAllProcesses = ref(false)
const allProcesses = ref<Awaited<ReturnType<typeof localScopeClient.allProcesses>>['data'] | null>(null)
const loadingAll = ref(false)

async function toggleAllProcesses(): Promise<void> {
  showAllProcesses.value = !showAllProcesses.value
  if (showAllProcesses.value && !allProcesses.value) {
    loadingAll.value = true
    try {
      allProcesses.value = (await localScopeClient.allProcesses()).data
    }
    catch {
      showAllProcesses.value = false
    }
    finally {
      loadingAll.value = false
    }
  }
}

/*
 * The unfiltered list is still fetched through the raw client with `all=true`.
 * That flag bypasses LocalScope's relevance filter and its cache, so it is kept
 * off the normalized endpoints entirely and remains what it always was: an
 * explicit, on-demand opt-in rather than anything polled.
 */
/**
 * Adapts a raw collector row to the normalized shape so the list below renders
 * one type. Only the `all=true` escape hatch needs this — everything polled
 * arrives normalized from the dashboard's own endpoint.
 */
function fromRaw(p: DevProcess): MachineProcess {
  return {
    id: p.id,
    pid: p.pid,
    ppid: p.ppid,
    name: p.name,
    command: p.command,
    cwd: p.cwd,
    runtime: p.runtime,
    cpuPercent: p.cpuPercent,
    memoryBytes: p.memoryBytes,
    elapsedSeconds: p.elapsedSeconds,
    startedAt: p.startedAt,
    ports: p.ports,
    relevanceReasons: p.relevanceReasons,
    // The raw client's mirrored ProjectRef predates LocalScope's `repo` field,
    // so this one adapter cannot supply it. Null is honest here: it means "not
    // known from this source", and only the `all=true` rows take this path.
    discoveredProject: p.project === null
      ? null
      : { ...p.project, repo: null },
  }
}

const allShown = computed<MachineProcess[]>(() =>
  (showAllProcesses.value ? allProcesses.value?.processes.map(fromRaw) : processItems.value) ?? [])

/*
 * The list is capped for rendering. With "show all" on a busy machine this is
 * ~900 rows, and painting them all costs far more than it informs — but the cap
 * must be stated, or the header's "906 of 906" would be contradicted by a list
 * that silently stops at 60.
 */
const RENDER_CAP = 60
const shownProcesses = computed(() => allShown.value.slice(0, RENDER_CAP))
const hiddenCount = computed(() => Math.max(0, allShown.value.length - RENDER_CAP))

const processTotal = computed(() => processes.data.value.total)
const relevantCount = computed(() => processItems.value?.length ?? null)

/*
 * Devices have a third state the other lists do not.
 *
 * `connected` is null when no adapter could run at all — no adb on PATH — and
 * the empty list beside it is then not a measurement. "Zero emulators" and "no
 * Android SDK installed" must not read identically.
 */
const deviceCount = computed(() => devices.data.value.connected)
/** The one count with no list behind it; read from the shared snapshot. */
const networkCount = computed(() => machine.snapshot.value.counts.network)
const noAdapterRan = computed(() => deviceItems.value !== null && deviceCount.value === null)
/** Names the adapters that could not run, in the collector's own words. */
const failedAdapters = computed(() =>
  devices.data.value.degraded.filter(d => d.kind !== 'partial').map(d => d.source).join(', '))

function stateTone(state: string): string {
  if (state === 'online')
    return 'text-success-text'
  if (state === 'unauthorized' || state === 'unavailable')
    return 'text-warning-text'
  return 'text-fg-mute'
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <p v-if="!anyLoaded" class="text-[13px] text-fg-mute" data-testid="localscope-connecting">
      Connecting to LocalScope…
    </p>

    <!--
      Never observed is the only state that hides the machine, because it is the
      only one where there is no machine data to show. A collector that has gone
      away is a banner, not a blank page.
    -->
    <ViewPlaceholder
      v-else-if="neverObserved"
      icon="◉"
      data-testid="localscope-placeholder"
      title="LocalScope is not running"
      summary="LocalScope collects the services, processes and devices on this machine. Start its collector and this page fills in automatically."
      requires="Start the collector: pnpm dev:collector in the LocalScope repo (127.0.0.1:7317)"
    />

    <template v-else>
      <p
        v-if="banner"
        :data-testid="`localscope-banner-${banner.tone}`"
        class="text-[12px] rounded-md border px-3 py-2"
        :class="banner.tone === 'stale'
          ? 'border-warning-text/40 text-warning-text'
          : 'border-line text-fg-mute'"
      >
        {{ banner.text }}
      </p>
      <!-- Local services -->
      <section class="flex flex-col gap-2">
        <header class="flex items-baseline gap-2">
          <h2 class="text-[13px] font-semibold text-fg">
            Local Services
          </h2>
          <span v-if="serviceItems" class="text-[11px] text-fg-faint font-mono">
            {{ serviceItems.length }} listening
          </span>
          <span v-if="servicesNote" data-testid="services-freshness" class="text-[11px] text-warning-text font-mono">
            {{ servicesNote }}
          </span>
        </header>
        <!-- Not knowing the list and knowing it is empty are different claims. -->
        <p v-if="!serviceItems" data-testid="services-unknown" class="text-[12px] text-fg-mute">
          Service list unavailable — LocalScope has not reported one.
        </p>
        <p v-else-if="serviceItems.length === 0" class="text-[12px] text-fg-mute">
          No listening development services right now.
        </p>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="localscope-services">
          <ServiceCard v-for="s in serviceItems" :key="s.id" :service="s" />
        </div>
      </section>

      <!-- Processes -->
      <section class="flex flex-col gap-2">
        <header class="flex items-center gap-2 flex-wrap">
          <h2 class="text-[13px] font-semibold text-fg">
            Processes
          </h2>
          <span v-if="relevantCount !== null && processTotal !== null" class="text-[11px] text-fg-faint font-mono">
            {{ showAllProcesses ? allShown.length : relevantCount }} of {{ processTotal }}
          </span>
          <span v-if="processesNote" data-testid="processes-freshness" class="text-[11px] text-warning-text font-mono">
            {{ processesNote }}
          </span>
          <button
            type="button"
            data-testid="toggle-all-processes"
            class="ml-auto text-[11px] px-2 py-1 rounded-md border border-line text-fg-mute hover:text-fg hover:border-line-strong transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            :aria-pressed="showAllProcesses"
            @click="toggleAllProcesses"
          >
            {{ showAllProcesses ? 'Development only' : 'Show all processes' }}
          </button>
        </header>

        <p v-if="loadingAll" class="text-[12px] text-fg-mute">
          Loading every process…
        </p>

        <p v-else-if="!processItems && !showAllProcesses" data-testid="processes-unknown" class="text-[12px] text-fg-mute">
          Process list unavailable — LocalScope has not reported one.
        </p>

        <ul v-else class="flex flex-col gap-1" data-testid="localscope-processes">
          <li
            v-for="p in shownProcesses"
            :key="p.id"
            class="border border-line rounded-md bg-card px-3 py-2 flex flex-col gap-1 min-w-0"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-[12px] font-semibold text-fg truncate">{{ p.name }}</span>
              <span class="text-[10px] font-mono text-fg-faint shrink-0">pid {{ p.pid }}</span>
              <span v-if="p.ports.length" class="text-[10px] font-mono text-accent shrink-0">
                :{{ p.ports.join(', :') }}
              </span>
              <span v-if="p.discoveredProject" class="ml-auto text-[10px] text-fg-mute truncate shrink-0">
                {{ p.discoveredProject.name }}
              </span>
            </div>
            <!-- A dev command line can be thousands of characters (bundler
                 flags, long paths). It is clamped to one line with the full
                 text in the title, and copyable for pasting into a shell. -->
            <div class="flex items-center gap-1 min-w-0">
              <code class="text-[10px] font-mono text-fg-faint truncate min-w-0 flex-1" :title="p.command">{{ p.command }}</code>
              <CopyButton :value="p.command" label="command" />
            </div>
            <!-- LocalScope's internal codes are never shown; the sentence is. -->
            <div v-if="p.relevanceReasons.length" class="flex flex-wrap gap-1">
              <span
                v-for="r in p.relevanceReasons"
                :key="r"
                class="text-[9px] px-1.5 py-0.5 rounded bg-raised text-fg-mute"
                :data-testid="`relevance-${r}`"
              >{{ relevanceLabel(r) }}</span>
            </div>
          </li>
        </ul>
        <p v-if="hiddenCount > 0" class="text-[11px] text-fg-faint" data-testid="processes-render-cap">
          Showing the first {{ RENDER_CAP }}; {{ hiddenCount }} more not rendered.
        </p>
      </section>

      <!-- Devices -->
      <section class="flex flex-col gap-2">
        <header class="flex items-baseline gap-2">
          <h2 class="text-[13px] font-semibold text-fg">
            Devices
          </h2>
          <span v-if="deviceCount !== null" class="text-[11px] text-fg-faint font-mono">
            {{ deviceCount }} connected
          </span>
          <span v-if="devicesNote" data-testid="devices-freshness" class="text-[11px] text-warning-text font-mono">
            {{ devicesNote }}
          </span>
        </header>

        <!-- Three different claims, three different sentences. -->
        <p v-if="!deviceItems" data-testid="devices-unknown" class="text-[12px] text-fg-mute">
          Device list unavailable — LocalScope has not reported one.
        </p>
        <p v-else-if="noAdapterRan" class="text-[12px] text-fg-mute" data-testid="devices-unavailable">
          No device adapter could run{{ failedAdapters ? ` (${failedAdapters})` : '' }} — Android requires adb on PATH.
          This is not the same as zero devices.
        </p>
        <p v-else-if="deviceItems.length === 0" class="text-[12px] text-fg-mute" data-testid="devices-none">
          No devices or emulators connected.
        </p>
        <ul v-else class="flex flex-col gap-1" data-testid="localscope-devices">
          <li
            v-for="d in deviceItems"
            :key="d.id"
            class="border border-line rounded-md bg-card px-3 py-2 flex items-center gap-2 min-w-0"
          >
            <span class="text-[12px] text-fg truncate">{{ d.model ?? d.serial }}</span>
            <span class="text-[10px] font-mono text-fg-faint">{{ d.platform }} · {{ d.form }}</span>
            <span v-if="d.osVersion" class="text-[10px] font-mono text-fg-faint">{{ d.osVersion }}</span>
            <span class="ml-auto text-[11px] shrink-0" :class="stateTone(d.state)">{{ d.state }}</span>
          </li>
        </ul>
      </section>

      <!--
        Network has a count and no detail view. The count is real — it comes
        from the same snapshot the Overview reads — so this section states what
        exists rather than claiming nothing was collected.
      -->
      <section class="flex flex-col gap-2">
        <header class="flex items-baseline gap-2">
          <h2 class="text-[13px] font-semibold text-fg">
            Network
          </h2>
          <span v-if="networkCount !== null" class="text-[11px] text-fg-faint font-mono" data-testid="network-count">
            {{ networkCount }} active
          </span>
        </header>
        <p class="text-[12px] text-fg-mute" data-testid="network-no-detail">
          {{ networkCount === null
            ? 'Connection count not collected.'
            : 'Connection count only — there is no per-connection view here yet.' }}
        </p>
      </section>
    </template>
  </section>
</template>
