<script setup lang="ts">
import type { MachineProcess, ProcessScan } from '@/features/localscope'
import { computed, ref } from 'vue'
import CopyButton from '@/components/ui/CopyButton.vue'
import { DataFreshnessIndicator, relevanceLabel, scanAllProcesses, useMachineProcesses } from '@/features/localscope'
import { bytesLabel, durationLabel, runtimeLabel } from '../format'
import RuntimeWorkspaceLabel from './RuntimeWorkspaceLabel.vue'

/*
 * Developer processes, as LocalScope filtered them: name, runtime, ports, the
 * workspace, and CPU and memory only when ps reported them.
 *
 * The row carries no PID, command line or path. The details disclosure — an
 * explicit, per-row request — shows PID, parent, running time, why the process
 * was listed, and the command line LocalScope reports (already sanitized on its
 * side). The working directory is never shown.
 *
 * "Scan all processes" is the explicit diagnostic: one request to the raw
 * collector with its relevance filter bypassed, made only on click and never
 * refreshed. It is not a mode that polls.
 */
const { data, loaded } = useMachineProcesses()

const items = computed(() => Array.isArray(data.value.items) ? data.value.items : null)

const scan = ref<ProcessScan | null>(null)
const scanning = ref(false)
const scanFailed = ref(false)

async function runScan(): Promise<void> {
  scanning.value = true
  scanFailed.value = false
  try {
    scan.value = await scanAllProcesses()
  }
  catch {
    scanFailed.value = true
  }
  finally {
    scanning.value = false
  }
}

function closeScan(): void {
  scan.value = null
  scanFailed.value = false
}

type ListState = 'loading' | 'unknown' | 'empty' | 'listed'
const state = computed<ListState>(() => {
  if (scan.value)
    return scan.value.items.length === 0 ? 'empty' : 'listed'
  if (!loaded.value && items.value === null)
    return 'loading'
  if (items.value === null)
    return 'unknown'
  return items.value.length === 0 ? 'empty' : 'listed'
})

const all = computed<MachineProcess[]>(() => scan.value?.items ?? items.value ?? [])

/*
 * The list is capped for rendering. A scan of a busy machine is ~900 rows, and
 * painting them all costs far more than it informs — so the cap is stated, or
 * "906 of 906" would be contradicted by a list that silently stops at 60.
 */
const RENDER_CAP = 60
const shown = computed(() => all.value.slice(0, RENDER_CAP))
const hiddenCount = computed(() => Math.max(0, all.value.length - RENDER_CAP))

const countText = computed(() => {
  if (scan.value)
    return `${scan.value.items.length} of ${scan.value.total}`
  if (items.value === null)
    return null
  return data.value.total === null ? `${items.value.length} developer` : `${items.value.length} of ${data.value.total}`
})

const scanTime = computed(() => scan.value ? new Date(scan.value.takenAt).toLocaleTimeString() : '')

const open = ref<Set<string>>(new Set())
function toggle(id: string): void {
  const next = new Set(open.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  open.value = next
}

function usage(p: MachineProcess): string[] {
  const parts: string[] = []
  if (p.cpuPercent !== null)
    parts.push(`${p.cpuPercent.toFixed(1)}% CPU`)
  if (p.memoryBytes !== null)
    parts.push(bytesLabel(p.memoryBytes))
  return parts
}
</script>

<template>
  <section aria-labelledby="runtime-processes-heading" class="flex min-w-0 flex-col gap-3" data-testid="runtime-processes" :data-state="state">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 id="runtime-processes-heading" class="m-0 text-title font-semibold text-fg">
        Processes
      </h2>
      <span v-if="countText" class="font-mono text-ui-sm tabular-nums text-fg-mute" data-testid="processes-count">{{ countText }}</span>
      <DataFreshnessIndicator v-if="!scan" :reading="data" testid="processes-freshness" />
      <button
        v-if="!scan"
        type="button"
        class="ml-auto cursor-pointer rounded-control border border-line bg-transparent px-2.5 py-1 text-ui-sm text-fg-mute transition-colors duration-[var(--duration-fast)] ease-standard hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent disabled:cursor-default disabled:opacity-60"
        :disabled="scanning"
        data-testid="process-scan"
        @click="runScan"
      >
        {{ scanning ? 'Scanning…' : 'Scan all processes' }}
      </button>
    </header>

    <p v-if="!scan" class="m-0 text-ui-sm text-fg-mute">
      Developer-relevant processes, as LocalScope filters them. Scanning all processes is a one-off diagnostic and is not refreshed.
    </p>

    <p v-if="scanFailed" class="m-0 text-ui-sm text-danger-text" data-testid="process-scan-error">
      The scan did not complete — LocalScope did not answer. The developer processes are still shown.
    </p>

    <div
      v-if="scan"
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-recessed px-3 py-2 text-ui-sm text-fg-mute"
      data-testid="process-scan-result"
    >
      <span class="min-w-0">
        <span class="font-semibold text-fg">Diagnostic scan</span>
        · every process LocalScope counted · taken at {{ scanTime }} · not refreshed
      </span>
      <span class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-control border border-line bg-transparent px-2 py-0.5 text-ui-sm text-fg-mute hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent disabled:opacity-60"
          :disabled="scanning"
          data-testid="process-scan-rescan"
          @click="runScan"
        >{{ scanning ? 'Scanning…' : 'Scan again' }}</button>
        <button
          type="button"
          class="cursor-pointer rounded-control border border-line bg-transparent px-2 py-0.5 text-ui-sm text-fg-mute hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
          data-testid="process-scan-close"
          @click="closeScan"
        >Back to developer processes</button>
      </span>
    </div>

    <p v-if="state === 'loading'" class="m-0 text-ui text-fg-mute" data-testid="processes-loading">
      Loading processes…
    </p>
    <p v-else-if="state === 'unknown'" class="m-0 text-ui text-fg-mute" data-testid="processes-unknown">
      Process list unavailable — LocalScope has not reported one. This is not the same as no processes.
    </p>
    <p v-else-if="state === 'empty'" class="m-0 text-ui text-fg-mute" data-testid="processes-none">
      No developer processes observed.
    </p>

    <ul v-else class="m-0 list-none divide-y divide-line overflow-hidden rounded-panel border border-line bg-card p-0" data-testid="processes-list">
      <li v-for="(p, i) in shown" :key="p.id" class="min-w-0" data-testid="process-row">
        <div
          class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_8rem_auto]"
        >
          <div class="flex min-w-0 flex-col">
            <span class="truncate text-ui font-semibold text-fg">{{ p.name }}</span>
            <span class="truncate text-ui-sm text-fg-mute" data-testid="process-runtime">{{ runtimeLabel(p.runtime) }}</span>
          </div>

          <ul v-if="p.ports.length" class="col-span-2 m-0 flex min-w-0 list-none flex-wrap gap-1 p-0 md:col-span-1" :aria-label="`Ports of ${p.name}`" data-testid="process-ports">
            <li v-for="port in p.ports" :key="port" class="rounded-full border border-line px-1.5 font-mono text-label tabular-nums text-fg-soft">
              :{{ port }}
            </li>
          </ul>
          <span v-else class="hidden md:block" aria-hidden="true" />

          <div class="col-span-2 min-w-0 md:col-span-1">
            <RuntimeWorkspaceLabel :workspace="p.workspace" />
          </div>

          <span
            v-if="usage(p).length"
            class="col-span-2 flex flex-wrap gap-x-2 font-mono text-ui-sm tabular-nums text-fg-mute md:col-span-1"
            data-testid="process-usage"
          >
            <span v-for="u in usage(p)" :key="u">{{ u }}</span>
          </span>
          <span v-else class="hidden md:block" aria-hidden="true" />

          <button
            type="button"
            class="col-start-2 row-start-1 cursor-pointer justify-self-end rounded-control border-none bg-transparent px-1 text-ui-sm text-fg-mute hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent md:col-start-5"
            :aria-expanded="open.has(p.id)"
            :aria-controls="`runtime-process-details-${i}`"
            data-testid="process-details-toggle"
            @click="toggle(p.id)"
          >
            Details<span class="sr-only"> for {{ p.name }}</span>
          </button>
        </div>

        <dl
          v-if="open.has(p.id)"
          :id="`runtime-process-details-${i}`"
          class="m-0 grid grid-cols-2 gap-x-4 gap-y-2 bg-recessed px-4 py-3 md:grid-cols-4"
          data-testid="process-details"
        >
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              PID
            </dt>
            <dd class="m-0 font-mono text-ui-sm tabular-nums text-fg-soft">
              {{ p.pid }} · parent {{ p.ppid }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Running for
            </dt>
            <dd class="m-0 font-mono text-ui-sm text-fg-soft">
              {{ p.elapsedSeconds === null ? 'Not reported' : durationLabel(p.elapsedSeconds) }}
            </dd>
          </div>
          <div class="col-span-2 min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Why it is listed
            </dt>
            <dd class="m-0 text-ui-sm text-fg-soft" data-testid="process-relevance">
              {{ p.relevanceReasons.length ? p.relevanceReasons.map(relevanceLabel).join(' · ') : 'Not stated' }}
            </dd>
          </div>
          <div class="col-span-2 min-w-0 md:col-span-4">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Command line, as LocalScope reports it
            </dt>
            <dd class="m-0 flex min-w-0 items-start gap-1">
              <code class="min-w-0 flex-1 break-all font-mono text-ui-sm text-fg-soft" data-testid="process-command">{{ p.command }}</code>
              <CopyButton :value="p.command" label="command line" />
            </dd>
          </div>
        </dl>
      </li>
    </ul>
    <p v-if="hiddenCount > 0" class="m-0 text-ui-sm text-fg-mute" data-testid="processes-render-cap">
      Showing the first {{ RENDER_CAP }}; {{ hiddenCount }} more not rendered.
    </p>
  </section>
</template>
