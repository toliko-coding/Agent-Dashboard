<script setup lang="ts">
import type { AgentStatusFilter } from '@/utils/agentStatusFilter'
import { AGENT_STATUS_FILTERS } from '@/utils/agentStatusFilter'

defineProps<{
  modelValue: AgentStatusFilter
  counts: Record<AgentStatusFilter, number>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: AgentStatusFilter] }>()
</script>

<template>
  <!--
    A real tablist: arrow keys move between filters and only the selected tab is
    in the tab order, which is what a screen reader user expects from a row of
    mutually exclusive filters.
  -->
  <div
    class="flex items-center gap-1 flex-wrap"
    role="tablist"
    aria-label="Filter agents by status"
    data-testid="agent-status-filters"
  >
    <button
      v-for="f in AGENT_STATUS_FILTERS"
      :key="f.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === f.value"
      :tabindex="modelValue === f.value ? 0 : -1"
      :data-testid="`agent-filter-${f.value}`"
      class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] border transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
      :class="modelValue === f.value
        ? 'bg-accent-soft text-accent border-accent font-semibold'
        : 'bg-card text-fg-mute border-line hover:text-fg hover:border-line-strong'"
      @click="emit('update:modelValue', f.value)"
    >
      {{ f.label }}
      <span
        class="font-mono text-[10px] tabular-nums"
        :class="modelValue === f.value ? 'text-accent' : 'text-fg-faint'"
      >{{ counts[f.value] }}</span>
    </button>
  </div>
</template>
