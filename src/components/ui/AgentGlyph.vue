<script setup lang="ts">
import type { Agent } from '@/types'
import type { AgentPurpose } from '@/utils/agentPurpose'
import { computed } from 'vue'
import { AGENT_PURPOSE_PATHS, agentPurpose, agentPurposeLabel } from '@/utils/agentPurpose'

/*
 * The agent's icon: what it is for (utils/agentPurpose), as the user chose
 * when starting it, or the neutral "general" glyph when nothing was chosen.
 *
 * Neutral on purpose: a purpose is who the agent is, not what it is doing, so
 * the tile takes no state colour and never animates. It is labelled for
 * assistive technology and carries a tooltip, so the glyph is never the only
 * way to learn it.
 *
 * Pass `purpose` to draw a category that is not yet an agent's (the New Agent
 * preview).
 */
const props = withDefaults(defineProps<{
  agent?: Pick<Agent, 'category'> | null
  purpose?: AgentPurpose
  size?: 'sm' | 'md'
}>(), { agent: null, purpose: undefined, size: 'md' })

const value = computed<AgentPurpose>(() => props.purpose ?? agentPurpose(props.agent ?? {}))
const label = computed(() => `${agentPurposeLabel(value.value)} agent`)
</script>

<template>
  <span
    role="img"
    :aria-label="label"
    :title="label"
    data-testid="agent-glyph"
    :data-category="value"
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
      <path v-for="d in AGENT_PURPOSE_PATHS[value]" :key="d" :d="d" />
    </svg>
  </span>
</template>
