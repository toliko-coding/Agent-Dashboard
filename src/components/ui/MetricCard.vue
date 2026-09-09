<script setup lang="ts">
import type { PanelState } from '@/features/cockpit/panelState'

/*
 * A single command-center metric.
 *
 * Reuses CockpitPanel's PanelState vocabulary rather than inventing a second
 * one, so the whole Overview agrees on what the states mean:
 *
 *   loading  — a request is in flight
 *   ready    — a real measurement; `value` is rendered
 *   empty    — measured, and the answer was genuinely zero
 *   notAsked — UNAVAILABLE: no collector exists, so nothing was measured
 *   failed   — the collector exists and errored
 *
 * The distinction that matters: `empty` renders 0, `notAsked` renders an em
 * dash and a reason. A metric with no collector must never render 0, because 0
 * asserts that the system looked.
 */
withDefaults(defineProps<{
  label: string
  state: PanelState
  /** Rendered only in the `ready` state. */
  value?: string | number
  /** Small qualifier under the value (e.g. "3 running"). */
  hint?: string
  /** Why the metric is unavailable/failed. Required reading for notAsked. */
  message?: string
  icon?: string
}>(), {
  value: undefined,
  hint: undefined,
  message: undefined,
  icon: undefined,
})
</script>

<template>
  <div
    class="bg-card border border-line rounded-xl px-3.5 py-3 flex flex-col gap-1 min-w-0"
    :class="state === 'notAsked' ? 'opacity-70' : ''"
    :data-testid="`metric-${label.toLowerCase().replace(/\s+/g, '-')}`"
    :data-state="state"
    :aria-busy="state === 'loading'"
  >
    <div class="flex items-center gap-1.5 min-w-0">
      <span v-if="icon" class="text-[12px] text-fg-faint shrink-0" aria-hidden="true">{{ icon }}</span>
      <span class="text-[10px] uppercase tracking-wider text-fg-faint font-bold truncate">{{ label }}</span>
    </div>

    <div v-if="state === 'loading'" class="text-[20px] font-mono text-fg-faint leading-none" role="status">
      <span class="sr-only">Loading {{ label }}</span>
      <span aria-hidden="true">…</span>
    </div>

    <template v-else-if="state === 'ready'">
      <span class="text-[20px] font-semibold font-mono tabular-nums text-fg leading-none">{{ value }}</span>
      <span v-if="hint" class="text-[10px] text-fg-mute truncate">{{ hint }}</span>
    </template>

    <!-- Measured, and the answer was nothing. A real 0. -->
    <template v-else-if="state === 'empty'">
      <span class="text-[20px] font-semibold font-mono tabular-nums text-fg-mute leading-none">0</span>
      <span v-if="hint" class="text-[10px] text-fg-mute truncate">{{ hint }}</span>
    </template>

    <!-- UNAVAILABLE: nothing measured. Never a zero. -->
    <template v-else-if="state === 'notAsked'">
      <span class="text-[20px] font-mono text-fg-faint leading-none" aria-hidden="true">—</span>
      <span class="text-[10px] text-fg-faint truncate" :title="message">{{ message ?? 'Not collected yet' }}</span>
      <span class="sr-only">{{ label }}: not collected yet</span>
    </template>

    <template v-else-if="state === 'failed'">
      <span class="text-[20px] font-mono text-danger-text leading-none" aria-hidden="true">—</span>
      <span class="text-[10px] text-danger-text truncate" :title="message" role="alert">{{ message ?? 'Failed to load' }}</span>
    </template>

    <template v-else>
      <span class="text-[20px] font-mono text-fg-faint leading-none" aria-hidden="true">—</span>
      <span class="text-[10px] text-fg-faint truncate">{{ message ?? 'Unavailable' }}</span>
    </template>
  </div>
</template>
