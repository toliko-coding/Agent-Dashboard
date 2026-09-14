<script setup lang="ts">
import type { Agent } from '@/types'
import type { AgentCategory } from '@/utils/agentCategory'
import { computed } from 'vue'
import { agentKind } from '@/utils/agentCategory'

/*
 * The agent's category as a small outlined tile (see utils/agentCategory).
 *
 * Neutral on purpose: a category is what an agent is, not what it is doing, so
 * the tile takes no state colour and never animates. It is labelled for
 * assistive technology and carries a tooltip, so the glyph is never the only
 * way to learn the category.
 */
const props = withDefaults(defineProps<{
  agent: Pick<Agent, 'pipelineTaskId' | 'internalProcess' | 'entrypoint' | 'liveInjectable'>
  size?: 'sm' | 'md'
}>(), { size: 'md' })

const kind = computed(() => agentKind(props.agent))

// One stroke vocabulary on a 24px grid; drawn, not emoji, so it follows the theme.
const PATHS: Record<AgentCategory, string[]> = {
  cli: ['M6 8l4 4-4 4', 'M12.5 16H18'],
  terminal: ['M4 5.5h16v13H4z', 'M7.5 10l2.5 2-2.5 2', 'M12 14h4.5'],
  desktop: ['M4 5h16v11H4z', 'M4 8.5h16', 'M9 19.5h6', 'M12 16v3.5'],
  task: ['M10 7h9', 'M10 12h9', 'M10 17h9', 'M4.5 7l1.2 1.2L7.8 6', 'M4.5 12l1.2 1.2 2.1-2.2', 'M4.5 17l1.2 1.2 2.1-2.2'],
  internal: ['M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z', 'M12 4v2.5', 'M12 17.5V20', 'M4 12h2.5', 'M17.5 12H20', 'M6.3 6.3l1.8 1.8', 'M15.9 15.9l1.8 1.8', 'M6.3 17.7l1.8-1.8', 'M15.9 8.1l1.8-1.8'],
}
</script>

<template>
  <span
    role="img"
    :aria-label="kind.label"
    :title="kind.label"
    data-testid="agent-glyph"
    :data-category="kind.category"
    class="inline-flex shrink-0 items-center justify-center rounded-control border border-line bg-raised text-fg-soft"
    :class="size === 'sm' ? 'size-5' : 'size-7'"
  >
    <svg
      viewBox="0 0 24 24"
      :class="size === 'sm' ? 'size-3.5' : 'size-[18px]'"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path v-for="d in PATHS[kind.category]" :key="d" :d="d" />
    </svg>
  </span>
</template>
