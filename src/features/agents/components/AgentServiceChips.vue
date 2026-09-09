<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { useAgentServices } from '../composables/useAgentServices'

/*
 * Compact runtime indicator for an agent card: the listening ports LocalScope
 * observed inside this agent's project.
 *
 * Rendering rules, all of them omissions rather than placeholders:
 *   - LocalScope unreachable/erroring → render nothing. The Overview and the
 *     LocalScope view already say the collector is down; an error badge on
 *     every card would repeat it once per agent for no added information.
 *   - collector healthy but no correlated service → render nothing. In
 *     particular never "Services 0": this component cannot distinguish
 *     "collected and none belong to this project" from "this project was not
 *     represented in the sample", and only the former would justify a zero.
 *
 * The count is per-agent by construction — it is the correlated subset, never
 * a machine-wide total, so a card can never display the whole machine's
 * service or connection count as if it belonged to one agent.
 */
const props = defineProps<{ agent: Agent }>()

const { available, services } = useAgentServices(() => props.agent)

// Two chips keep the card compact; the rest are counted rather than listed.
const MAX_CHIPS = 2
const shown = computed(() => services.value.slice(0, MAX_CHIPS))
const overflow = computed(() => Math.max(0, services.value.length - MAX_CHIPS))

const label = computed(() =>
  `${services.value.length} local ${services.value.length === 1 ? 'service' : 'services'} in this project: ${services.value.map(s => `${s.label} on port ${s.port}`).join(', ')}`)
</script>

<template>
  <span
    v-if="available && services.length > 0"
    class="flex items-center gap-1 shrink-0"
    data-testid="agent-service-chips"
    :title="label"
  >
    <span class="sr-only">{{ label }}</span>
    <span
      v-for="s in shown"
      :key="s.id"
      :data-testid="`agent-service-${s.port}`"
      class="inline-flex items-center gap-1 rounded px-1 py-0.5 bg-success-soft text-success-text text-[10px] font-mono leading-none"
      aria-hidden="true"
    >
      <span class="size-1.5 rounded-full bg-success-dot shrink-0" />:{{ s.port }}
    </span>
    <span
      v-if="overflow > 0"
      class="text-[10px] font-mono text-fg-faint"
      data-testid="agent-service-overflow"
      aria-hidden="true"
    >+{{ overflow }}</span>
  </span>
</template>
