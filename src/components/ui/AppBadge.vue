<script setup lang="ts">
import { computed } from 'vue'
import { statusLabel } from '../../utils/statusColors'

type Variant = 'active' | 'working' | 'waiting' | 'idle' | 'finished' | 'completed' | 'error' | 'info'

const props = defineProps<{ variant: Variant, label?: string }>()

/*
 * Presentation for one agent state, in one table.
 *
 * `motion` is empty for every state where nothing is happening, which is the
 * point: a badge moves only while the system is doing something. Previously
 * `working` carried Tailwind's `animate-pulse` — a fixed opacity throb at the
 * same rate as every other spinner in every other app — so it read as
 * decoration rather than as a claim about this agent.
 *
 * Motion is never the only encoding. Each row also carries a colour and a text
 * label, and the label is rendered twice: once visibly and once for assistive
 * technology. A viewer with prefers-reduced-motion loses the emphasis and keeps
 * the state.
 */
const PRESENTATION: Record<Variant, { dot: string, label: string, motion: string }> = {
  active: { dot: 'bg-state-live', label: 'text-success-text', motion: '' },
  working: { dot: 'bg-state-working', label: 'text-state-working', motion: 'motion-working' },
  waiting: { dot: 'bg-state-waiting', label: 'text-state-waiting', motion: '' },
  idle: { dot: 'bg-state-idle', label: 'text-fg-mute', motion: '' },
  finished: { dot: 'bg-state-idle', label: 'text-fg-mute', motion: '' },
  completed: { dot: 'bg-state-idle', label: 'text-fg-mute', motion: '' },
  error: { dot: 'bg-state-error', label: 'text-state-error', motion: '' },
  info: { dot: 'bg-state-working', label: 'text-state-working', motion: '' },
}

const presentation = computed(() => PRESENTATION[props.variant])
const displayLabel = computed(() => props.label ?? statusLabel(props.variant))
</script>

<template>
  <!-- UX-15: status conveyed via color dot + visible text label; sr-only provides AT fallback -->
  <span class="inline-flex items-center gap-1.5 text-xs" :data-state="variant">
    <span
      class="size-2 rounded-full flex-shrink-0"
      :class="[presentation.dot, presentation.motion]"
      data-testid="state-dot"
      aria-hidden="true"
    />
    <span :class="presentation.label" aria-hidden="true">{{ displayLabel }}</span>
    <span class="sr-only">{{ displayLabel }}</span>
  </span>
</template>
