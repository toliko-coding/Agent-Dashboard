<script setup lang="ts">
import type { Agent } from '../../types'
import { computed } from 'vue'
import { formatCost } from '../../utils/format'

const props = defineProps<{
  label: string
  agents: Agent[]
  collapsed?: boolean
  derivedFrom?: string
  /**
   * A structural word introducing the label, e.g. "Repository". Rendered as
   * text, not implied by styling, so the hierarchy survives without sight of
   * indentation or colour.
   */
  prefix?: string
  /** An extra count that is true of this group's data, e.g. "2 workspaces". */
  detail?: string
}>()

const emit = defineEmits<{ toggle: [] }>()

const totalCost = computed(() => props.agents.reduce((sum, a) => sum + a.costEstimate, 0))
const chevron = computed(() => props.collapsed ? '▶' : '▼')

// Unchanged from before when no prefix is given, so existing modes announce
// exactly as they did.
const ariaLabel = computed(() => {
  const name = props.prefix ? `${props.prefix} ${props.label}` : props.label
  const base = `Toggle ${name} group`
  return props.derivedFrom ? `${base} — ${props.derivedFrom}` : base
})
</script>

<template>
  <button
    type="button"
    class="w-full flex items-center gap-2 px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-ring rounded"
    :aria-expanded="!collapsed"
    :aria-label="ariaLabel"
    data-testid="group-header-toggle"
    @click="emit('toggle')"
  >
    <span class="text-fg-soft text-xs leading-none w-4 inline-block text-center" aria-hidden="true">{{ chevron }}</span>
    <span v-if="prefix" class="text-[10px] uppercase tracking-wider text-fg-faint" data-testid="group-header-prefix">{{ prefix }}</span>
    <span class="font-mono text-[11px] font-semibold text-fg-soft">{{ label }}</span>
    <span
      v-if="derivedFrom"
      class="text-[11px] text-fg-faint cursor-help"
      :title="derivedFrom"
      data-testid="group-derived-marker"
    >~</span>
    <span v-if="detail" class="text-[11px] text-fg-faint" data-testid="group-header-detail">{{ detail }}</span>
    <span class="text-[11px] text-fg-faint">{{ agents.length }} {{ agents.length === 1 ? 'agent' : 'agents' }}</span>
    <span class="flex-1 h-px bg-line" />
    <!-- The sum of these sessions' cost estimates, not a calendar-day figure: the status bar reports that from the persisted ledger. -->
    <span class="font-mono text-[11px] text-fg-faint">{{ formatCost(totalCost) }} session cost</span>
  </button>
</template>
