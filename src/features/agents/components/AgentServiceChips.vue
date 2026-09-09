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
 *
 * A chip is a link ONLY when LocalScope reported a real `url`. It never builds
 * one from the port: the collector sets `url` to null precisely when the
 * listener is not HTTP-ish, so inventing `http://localhost:<port>` would send
 * the user at a database or an inspector socket.
 */
const props = defineProps<{ agent: Agent }>()

const { available, services } = useAgentServices(() => props.agent)

// Two chips keep the card compact; the rest are counted rather than listed.
const MAX_CHIPS = 2
const shown = computed(() => services.value.slice(0, MAX_CHIPS))
const overflow = computed(() => Math.max(0, services.value.length - MAX_CHIPS))

const label = computed(() =>
  `${services.value.length} local ${services.value.length === 1 ? 'service' : 'services'} in this project: ${services.value.map(s => `${s.label} on port ${s.port}`).join(', ')}`)

/** Per-chip accessible name — the anchor needs its own, not the group's. */
function chipLabel(s: { label: string, port: number, url: string | null }): string {
  return s.url
    ? `Open ${s.label} at ${s.url}`
    : `${s.label} on port ${s.port}`
}

const CHIP_CLASS = 'inline-flex items-center gap-1 rounded px-1 py-0.5 bg-success-soft text-success-text text-[10px] font-mono leading-none'
</script>

<template>
  <span
    v-if="available && services.length > 0"
    class="flex items-center gap-1 shrink-0"
    data-testid="agent-service-chips"
    :title="label"
  >
    <span class="sr-only">{{ label }}</span>

    <template v-for="s in shown" :key="s.id">
      <!--
        Opening the service is the useful action, and an anchor gives it
        keyboard access, middle-click and "open in new tab" for free. `.stop`
        keeps the click off the card, which would otherwise open the workspace
        behind the new tab.
      -->
      <a
        v-if="s.url"
        :href="s.url"
        target="_blank"
        rel="noopener noreferrer"
        :data-testid="`agent-service-${s.port}`"
        :class="`${CHIP_CLASS} hover:brightness-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent transition-[filter] duration-[var(--duration-fast)] ease-standard`"
        :aria-label="chipLabel(s)"
        @click.stop
        @keydown.enter.stop
      >
        <span class="size-1.5 rounded-full bg-success-dot shrink-0" aria-hidden="true" />:{{ s.port }}
      </a>

      <!-- No URL reported: a listener that is not HTTP-ish. Shown, not linked. -->
      <span
        v-else
        :data-testid="`agent-service-${s.port}`"
        :class="CHIP_CLASS"
        :title="chipLabel(s)"
      >
        <span class="size-1.5 rounded-full bg-success-dot shrink-0" aria-hidden="true" />:{{ s.port }}
      </span>
    </template>

    <span
      v-if="overflow > 0"
      class="text-[10px] font-mono text-fg-faint"
      data-testid="agent-service-overflow"
      aria-hidden="true"
    >+{{ overflow }}</span>
  </span>
</template>
