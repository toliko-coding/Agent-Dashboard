<script setup lang="ts">
import { computed, ref } from 'vue'
import ViewPlaceholder from '@/components/ViewPlaceholder.vue'
import { localScopeClient } from '../client'
import {
  useLocalScopeDevices,
  useLocalScopeProcesses,
  useLocalScopeServices,
  useLocalScopeSummary,
} from '../composables/useLocalScope'
import { relevanceLabel } from '../types'
import ServiceCard from './ServiceCard.vue'

/*
 * The LocalScope page. This app is a CONSUMER: every number here was collected,
 * classified and correlated by LocalScope. No ps/lsof/adb parsing, no process
 * classification and no project correlation is repeated on this side.
 */
const summary = useLocalScopeSummary()
const services = useLocalScopeServices()
const processes = useLocalScopeProcesses()
const devices = useLocalScopeDevices()

const connected = computed(() => summary.reachable.value === true)

/*
 * LocalScope filters hundreds of macOS processes down to the developer-relevant
 * ones. That filtering is the product, so it stays the default; "all" is an
 * explicit opt-in fetched on demand rather than a second poller.
 */
const showAllProcesses = ref(false)
const allProcesses = ref<Awaited<ReturnType<typeof localScopeClient.processes>>['data'] | null>(null)
const loadingAll = ref(false)

async function toggleAllProcesses(): Promise<void> {
  showAllProcesses.value = !showAllProcesses.value
  if (showAllProcesses.value && !allProcesses.value) {
    loadingAll.value = true
    try {
      allProcesses.value = (await localScopeClient.processes(true)).data
    }
    catch {
      showAllProcesses.value = false
    }
    finally {
      loadingAll.value = false
    }
  }
}

const shownProcesses = computed(() =>
  (showAllProcesses.value ? allProcesses.value?.processes : processes.data.value?.processes) ?? [])

const processTotal = computed(() => processes.data.value?.total ?? null)
const relevantCount = computed(() => processes.data.value?.processes.length ?? null)

const deviceList = computed(() => devices.data.value ?? [])

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
    <!-- Not running is an expected state for an optional collector. -->
    <ViewPlaceholder
      v-if="summary.reachable.value === false"
      icon="◉"
      title="LocalScope is not running"
      summary="LocalScope collects the services, processes and devices on this machine. Start its collector and this page fills in automatically."
      requires="Start the collector: pnpm dev:collector in the LocalScope repo (127.0.0.1:7317)"
    />

    <p v-else-if="!summary.loaded.value" class="text-[13px] text-fg-mute">
      Connecting to LocalScope…
    </p>

    <p v-else-if="summary.error.value" class="text-[13px] text-danger-text">
      {{ summary.error.value }}
    </p>

    <template v-else-if="connected">
      <!-- Local services -->
      <section class="flex flex-col gap-2">
        <header class="flex items-baseline gap-2">
          <h2 class="text-[13px] font-semibold text-fg">
            Local Services
          </h2>
          <span class="text-[11px] text-fg-faint font-mono">
            {{ services.data.value?.length ?? 0 }} listening
          </span>
        </header>
        <p v-if="(services.data.value?.length ?? 0) === 0" class="text-[12px] text-fg-mute">
          No listening development services right now.
        </p>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="localscope-services">
          <ServiceCard v-for="s in services.data.value ?? []" :key="s.id" :service="s" />
        </div>
      </section>

      <!-- Processes -->
      <section class="flex flex-col gap-2">
        <header class="flex items-center gap-2 flex-wrap">
          <h2 class="text-[13px] font-semibold text-fg">
            Processes
          </h2>
          <span v-if="relevantCount !== null && processTotal !== null" class="text-[11px] text-fg-faint font-mono">
            {{ showAllProcesses ? shownProcesses.length : relevantCount }} of {{ processTotal }}
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

        <ul v-else class="flex flex-col gap-1" data-testid="localscope-processes">
          <li
            v-for="p in shownProcesses.slice(0, 60)"
            :key="p.id"
            class="border border-line rounded-md bg-card px-3 py-2 flex flex-col gap-1 min-w-0"
          >
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-[12px] font-semibold text-fg truncate">{{ p.name }}</span>
              <span class="text-[10px] font-mono text-fg-faint shrink-0">pid {{ p.pid }}</span>
              <span v-if="p.ports.length" class="text-[10px] font-mono text-accent shrink-0">
                :{{ p.ports.join(', :') }}
              </span>
              <span v-if="p.project" class="ml-auto text-[10px] text-fg-mute truncate shrink-0">
                {{ p.project.name }}
              </span>
            </div>
            <div class="text-[10px] font-mono text-fg-faint truncate" :title="p.command">
              {{ p.command }}
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
      </section>

      <!-- Devices -->
      <section class="flex flex-col gap-2">
        <header class="flex items-baseline gap-2">
          <h2 class="text-[13px] font-semibold text-fg">
            Devices
          </h2>
          <span class="text-[11px] text-fg-faint font-mono">
            {{ summary.data.value?.devices.connected ?? '—' }}
            {{ summary.data.value?.devices.connected === null ? 'not collected' : 'connected' }}
          </span>
        </header>

        <p v-if="summary.data.value?.devices.connected === null" class="text-[12px] text-fg-mute" data-testid="devices-unavailable">
          No device adapter could run — Android requires adb on PATH. This is not the same as zero devices.
        </p>
        <p v-else-if="deviceList.length === 0" class="text-[12px] text-fg-mute">
          No devices or emulators connected.
        </p>
        <ul v-else class="flex flex-col gap-1" data-testid="localscope-devices">
          <li
            v-for="d in deviceList"
            :key="d.id"
            class="border border-line rounded-md bg-card px-3 py-2 flex items-center gap-2 min-w-0"
          >
            <span class="text-[12px] text-fg truncate">{{ d.model ?? d.serial }}</span>
            <span class="text-[10px] font-mono text-fg-faint">{{ d.platform }} · {{ d.form }}</span>
            <span v-if="d.osVersion" class="text-[10px] font-mono text-fg-faint">{{ d.osVersion }}</span>
            <span class="ml-auto text-[11px] shrink-0" :class="stateTone(d.state)">{{ d.state }}</span>
          </li>
        </ul>

        <!-- iOS has no adapter yet; it must not read as "0 iOS devices". -->
        <p class="text-[10px] text-fg-faint" data-testid="ios-not-collected">
          iOS simulators — not collected yet
        </p>
      </section>

      <!-- Network -->
      <section class="flex flex-col gap-2">
        <h2 class="text-[13px] font-semibold text-fg">
          Network
        </h2>
        <p class="text-[12px] text-fg-mute" data-testid="network-not-collected">
          Not collected yet — LocalScope defines the model but its network collector is not implemented.
        </p>
      </section>
    </template>
  </section>
</template>
