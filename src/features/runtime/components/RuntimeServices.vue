<script setup lang="ts">
import type { MachineService } from '@/features/localscope'
import { computed, ref } from 'vue'
import { DataFreshnessIndicator, useMachineServices } from '@/features/localscope'
import { runtimeLabel } from '../format'
import RuntimeWorkspaceLabel from './RuntimeWorkspaceLabel.vue'

/*
 * Listening services, one row each: port, what LocalScope says is on it, and
 * the workspace it runs in.
 *
 * LocalScope did the classification (label, kind, confidence), so this only
 * presents it. `confidence` qualifies the label and kind, never the port, so a
 * low-confidence classification is marked as a guess. A service bound to all
 * interfaces is flagged in words: that is reachable from the network.
 *
 * Nothing path-shaped is on a row or in its details — no cwd, no discovered
 * project root, no command line. The workspace is the server-resolved identity
 * or "Workspace unknown".
 *
 * `items: null` is "not known" and `[]` is "looked, found none"; the two never
 * share a sentence. A stale list keeps its rows and says it is stale.
 */
const { data, loaded } = useMachineServices()

const items = computed(() => Array.isArray(data.value.items) ? data.value.items : null)
const sorted = computed(() => items.value ? [...items.value].sort((a, b) => a.port - b.port) : [])

type ListState = 'loading' | 'unknown' | 'empty' | 'listed'
const state = computed<ListState>(() => {
  if (!loaded.value && items.value === null)
    return 'loading'
  if (items.value === null)
    return 'unknown'
  return items.value.length === 0 ? 'empty' : 'listed'
})

const open = ref<Set<string>>(new Set())
function toggle(id: string): void {
  const next = new Set(open.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  open.value = next
}

function name(s: MachineService): string {
  return s.label || s.processName
}

function startedLabel(iso: string | null): string | null {
  if (!iso)
    return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}
</script>

<template>
  <section aria-labelledby="runtime-services-heading" class="flex min-w-0 flex-col gap-3" data-testid="runtime-services" :data-state="state">
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id="runtime-services-heading" class="m-0 text-title font-semibold text-fg">
        Services
      </h2>
      <span v-if="items" class="font-mono text-ui-sm tabular-nums text-fg-mute" data-testid="services-count">{{ items.length }} listening</span>
      <DataFreshnessIndicator :reading="data" testid="services-freshness" />
    </header>

    <p v-if="state === 'loading'" class="m-0 text-ui text-fg-mute" data-testid="services-loading">
      Loading services…
    </p>
    <p v-else-if="state === 'unknown'" class="m-0 text-ui text-fg-mute" data-testid="services-unknown">
      Service list unavailable — LocalScope has not reported one. This is not the same as no services.
    </p>
    <p v-else-if="state === 'empty'" class="m-0 text-ui text-fg-mute" data-testid="services-none">
      No listening development services right now.
    </p>

    <ul v-else class="m-0 list-none divide-y divide-line overflow-hidden rounded-panel border border-line bg-card p-0" data-testid="services-list">
      <li v-for="(s, i) in sorted" :key="s.id" class="min-w-0" data-testid="service-row">
        <div
          class="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[4.75rem_minmax(0,1.2fr)_minmax(0,1fr)_auto]"
        >
          <span class="justify-self-start rounded-full border border-line px-2 py-0.5 font-mono text-ui-sm font-semibold tabular-nums text-fg" data-testid="service-port">:{{ s.port }}</span>

          <div class="flex min-w-0 flex-col">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-ui font-semibold text-fg">{{ name(s) }}</span>
              <span
                v-if="s.confidence === 'low'"
                class="shrink-0 rounded-control border border-line px-1 text-label text-fg-mute"
                title="LocalScope inferred this from weak evidence — treat it as a guess"
                data-testid="service-guess"
              >guess</span>
            </span>
            <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui-sm text-fg-mute">
              <span class="truncate" data-testid="service-runtime">{{ runtimeLabel(s.runtime) }}</span>
              <span
                v-if="s.bindScope === 'all'"
                class="text-warning-text"
                title="Bound to all interfaces — reachable from your network"
                data-testid="service-all-interfaces"
              >All interfaces<span class="sr-only"> — reachable from your network</span></span>
            </span>
          </div>

          <div class="col-span-2 col-start-2 row-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
            <RuntimeWorkspaceLabel :workspace="s.workspace" />
          </div>

          <div class="col-start-3 row-start-1 flex items-center gap-3 justify-self-end md:col-start-4">
            <a
              v-if="s.url"
              :href="s.url"
              target="_blank"
              rel="noopener noreferrer"
              class="rounded-control text-ui-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
              data-testid="service-open"
            >Open<span class="sr-only"> {{ name(s) }} on port {{ s.port }}, in a new tab</span></a>
            <button
              type="button"
              class="cursor-pointer rounded-control border-none bg-transparent px-1 text-ui-sm text-fg-mute hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
              :aria-expanded="open.has(s.id)"
              :aria-controls="`runtime-service-details-${i}`"
              data-testid="service-details-toggle"
              @click="toggle(s.id)"
            >
              Details<span class="sr-only"> for port {{ s.port }}</span>
            </button>
          </div>
        </div>

        <dl
          v-if="open.has(s.id)"
          :id="`runtime-service-details-${i}`"
          class="m-0 grid grid-cols-2 gap-x-4 gap-y-2 bg-recessed px-4 py-3 md:grid-cols-4"
          data-testid="service-details"
        >
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Address
            </dt>
            <dd class="m-0 break-all font-mono text-ui-sm text-fg-soft">
              {{ s.address }}:{{ s.port }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Process
            </dt>
            <dd class="m-0 truncate font-mono text-ui-sm text-fg-soft">
              {{ s.processName }} · pid {{ s.pid }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Protocol
            </dt>
            <dd class="m-0 font-mono text-ui-sm text-fg-soft">
              {{ s.protocol }} · {{ s.ipVersion }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Bound to
            </dt>
            <dd class="m-0 text-ui-sm" :class="s.bindScope === 'all' ? 'text-warning-text' : 'text-fg-soft'" data-testid="service-scope">
              {{ s.bindScope === 'all' ? 'all interfaces — reachable from your network' : s.bindScope }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Classified as
            </dt>
            <dd class="m-0 text-ui-sm text-fg-soft">
              {{ s.kind }} · {{ s.confidence }} confidence
            </dd>
          </div>
          <div v-if="startedLabel(s.startedAt)" class="min-w-0">
            <dt class="text-label uppercase tracking-wider text-fg-mute">
              Started
            </dt>
            <dd class="m-0 text-ui-sm text-fg-soft">
              {{ startedLabel(s.startedAt) }}
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>
