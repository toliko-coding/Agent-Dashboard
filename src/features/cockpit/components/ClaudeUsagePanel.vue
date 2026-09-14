<script setup lang="ts">
import type { PanelState } from '../panelState'
import type { WindowData } from '@/composables/useUsage'
import type { Agent } from '@/types'
import { computed } from 'vue'
import { useUsage } from '@/composables/useUsage'
import { formatCost } from '@/utils/format'
import { barWidth, RESOURCE_LEVEL_BAR, RESOURCE_LEVEL_TEXT, RESOURCE_LEVEL_WORD, resourceLevel } from '@/utils/resourceLevel'
import CockpitPanel from './CockpitPanel.vue'

/*
 * Claude usage, from the data the dashboard actually has.
 *
 *   Rolling windows  GET /api/usage: tokens and estimated cost summed from the
 *                    Claude session logs on this machine over the last 5 hours
 *                    and 7 days. A budget share appears only when a budget is
 *                    configured; otherwise the panel says there is none.
 *   Running now      the estimated cost of the sessions running now, from the
 *                    agent stream — session totals, not spend in a period.
 *
 * Deliberately not claimed: the plan's own rate limits or remaining quota
 * (Anthropic's figures are not available locally), and any per-day figure.
 * The poll is App.vue's; this panel reads the shared response and opens no
 * request of its own.
 */
const props = defineProps<{
  /** Live sessions from the agent stream; null before agents are observed. */
  sessions: Agent[] | null
}>()

const { data, error } = useUsage()

const state = computed<PanelState>(() => {
  if (data.value)
    return 'ready'
  return error.value ? 'failed' : 'loading'
})

const WINDOW_LABEL: Record<string, string> = { '5h': 'Last 5 hours', '7d': 'Last 7 days' }

function tokenLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0)
    return '0'
  if (n < 1000)
    return String(n)
  if (n < 1_000_000)
    return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function costLabel(cents: number): string {
  return cents > 0 ? formatCost(cents / 100) : '$0.00'
}

const windows = computed(() => (data.value?.windows ?? []).map((w: WindowData) => {
  const pct = w.pct === null ? null : w.pct * 100
  return {
    key: w.key,
    label: WINDOW_LABEL[w.key] ?? w.key,
    tokens: tokenLabel(w.tokens),
    cost: costLabel(w.costCents),
    pct,
    level: pct === null ? null : resourceLevel(pct),
  }
}))

const accounts = computed(() => (data.value?.accounts?.length ?? 0) > 1 ? data.value!.accounts : [])

const running = computed(() => {
  if (!props.sessions)
    return null
  const priced = props.sessions.filter(a => !a.costUnknown)
  const total = priced.reduce((sum, a) => sum + (Number.isFinite(a.costEstimate) ? a.costEstimate : 0), 0)
  return { count: props.sessions.length, unpriced: props.sessions.length - priced.length, total }
})
</script>

<template>
  <CockpitPanel id="usage" title="Claude usage" :state="state" :message="error ?? undefined">
    <template #action>
      <span class="text-label text-fg-faint">from local session logs</span>
    </template>

    <div class="flex flex-col gap-3">
      <dl class="m-0 grid grid-cols-2 gap-3" data-testid="usage-windows">
        <div
          v-for="w in windows"
          :key="w.key"
          class="flex min-w-0 flex-col gap-1 rounded-control border border-line px-2.5 py-2"
          :data-testid="`usage-window-${w.key}`"
        >
          <dt class="text-label uppercase tracking-wider text-fg-faint">
            {{ w.label }}
          </dt>
          <dd class="m-0 flex items-baseline gap-1.5">
            <span class="font-mono text-title font-semibold tabular-nums text-fg" data-testid="usage-tokens">{{ w.tokens }}</span>{{ ' ' }}
            <span class="text-ui-sm text-fg-mute">tokens</span>
          </dd>
          <dd class="m-0 text-ui-sm text-fg-mute" data-testid="usage-cost">
            ≈ <span class="font-mono tabular-nums text-fg-soft">{{ w.cost }}</span> estimated
          </dd>
          <dd v-if="w.pct !== null && w.level" class="m-0 flex flex-col gap-1" data-testid="usage-budget" :data-level="w.level">
            <span class="h-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <span class="block h-full rounded-full" :class="RESOURCE_LEVEL_BAR[w.level]" :style="{ width: barWidth(w.pct) }" />
            </span>
            <span class="text-label" :class="RESOURCE_LEVEL_TEXT[w.level]">
              {{ Math.round(w.pct) }}% of budget<template v-if="RESOURCE_LEVEL_WORD[w.level]"> · {{ RESOURCE_LEVEL_WORD[w.level] }}</template>
            </span>
          </dd>
          <dd v-else class="m-0 text-label text-fg-faint" data-testid="usage-no-budget">
            No budget set
          </dd>
        </div>
      </dl>

      <ul v-if="accounts.length" class="m-0 flex list-none flex-col gap-0.5 p-0 text-ui-sm" aria-label="Usage by account" data-testid="usage-accounts">
        <li v-for="a in accounts" :key="a.label" class="flex min-w-0 items-baseline gap-2">
          <span class="min-w-0 truncate text-fg-soft">{{ a.label }}</span>{{ ' ' }}
          <span class="ml-auto shrink-0 font-mono tabular-nums text-fg-mute">5h {{ tokenLabel(a.w5h.tokens) }} · 7d {{ tokenLabel(a.w7d.tokens) }}</span>
        </li>
      </ul>

      <p v-if="running" class="m-0 flex flex-wrap items-baseline gap-x-1.5 border-t border-line pt-2 text-ui-sm text-fg-mute" data-testid="usage-running">
        <span class="text-label uppercase tracking-wider text-fg-faint">Running now</span>{{ ' ' }}
        <span>{{ running.count }} {{ running.count === 1 ? 'session' : 'sessions' }}</span>{{ ' ' }}
        <template v-if="running.count > 0">
          <span aria-hidden="true">·</span>{{ ' ' }}
          <span>≈ <span class="font-mono tabular-nums text-fg-soft">{{ running.total > 0 ? formatCost(running.total) : '$0.00' }}</span> estimated so far</span>{{ ' ' }}
          <span v-if="running.unpriced > 0" class="text-fg-faint">({{ running.unpriced }} without pricing)</span>
        </template>
      </p>

      <p class="m-0 text-label text-fg-faint" data-testid="usage-source">
        Estimated from Claude session logs on this machine. Not your plan's rate limits.
      </p>
    </div>
  </CockpitPanel>
</template>
