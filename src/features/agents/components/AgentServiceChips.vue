<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { useAgentServices } from '../composables/useAgentServices'

/*
 * Compact runtime indicator for an agent card: the listening ports LocalScope
 * observed inside this agent's project.
 *
 * Rendering rules:
 *   - source-unavailable → render nothing. Command and the Runtime page
 *     already say the collector is down; an error badge on every card would
 *     repeat it once per agent for no added information.
 *   - agent-unresolved → a small NEUTRAL marker. A list exists but this agent
 *     has no workspace identity, so attribution was never attempted; rendering
 *     nothing here would silently claim "no services", which is a different
 *     statement and not one this component is entitled to make. Neutral, not
 *     danger: unresolvable identity is an ordinary condition (a process with no
 *     readable cwd has none either), not a fault to alarm anyone about.
 *   - resolved with matches → the chips.
 *   - resolved, zero matches, nothing unattributed → render nothing. This is
 *     the one true zero, and it stays an omission rather than "Services 0".
 *   - resolved with unattributed observations alongside → the matches are shown
 *     in full and the remainder is noted, never attached.
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

const { available, attribution, services, unresolvedCount } = useAgentServices(() => props.agent)

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

// Neutral, like the topology's port pills: a listening port is an observation, not success or health.
const CHIP_CLASS = 'inline-flex items-center gap-1 rounded border border-line px-1 py-0.5 bg-raised text-fg-soft text-[10px] font-mono leading-none'
</script>

<template>
  <!--
    Attribution could not be attempted: a list was observed, but this agent has
    no workspace identity to compare it against. Saying nothing would read as
    "no services", so this says the true thing instead.
  -->
  <span
    v-if="attribution === 'agent-unresolved'"
    class="inline-flex items-center gap-1 shrink-0 rounded px-1 py-0.5 bg-neutral-soft text-neutral-text text-[10px] font-mono leading-none"
    data-testid="agent-service-identity-unknown"
    title="This agent's workspace could not be identified, so local services cannot be attributed to it. This is not an error, and does not mean the workspace has no services."
  >
    <span class="size-1.5 rounded-full bg-state-idle shrink-0" aria-hidden="true" />
    <span aria-hidden="true">identity unknown</span>
    <span class="sr-only">Workspace identity unavailable, so local services cannot be attributed to this agent.</span>
  </span>

  <span
    v-else-if="available && services.length > 0"
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
        <span class="size-1.5 rounded-full bg-fg-faint shrink-0" aria-hidden="true" />:{{ s.port }}
      </a>

      <!-- No URL reported: a listener that is not HTTP-ish. Shown, not linked. -->
      <span
        v-else
        :data-testid="`agent-service-${s.port}`"
        :class="CHIP_CLASS"
        :title="chipLabel(s)"
      >
        <span class="size-1.5 rounded-full bg-fg-faint shrink-0" aria-hidden="true" />:{{ s.port }}
      </span>
    </template>

    <!--
      Some observations in the sample carry no identity, so this agent's list is
      "everything I could attribute", not "everything there is". Stated quietly
      beside the matches rather than allowed to silently qualify them.
    -->
    <span
      v-if="unresolvedCount > 0"
      class="text-[10px] font-mono text-fg-faint"
      data-testid="agent-service-unattributed"
      :title="`${unresolvedCount} local ${unresolvedCount === 1 ? 'service' : 'services'} could not be attributed to any workspace, so this list may be incomplete.`"
    >
      <span aria-hidden="true">?{{ unresolvedCount }}</span>
      <span class="sr-only">{{ unresolvedCount }} unattributed local {{ unresolvedCount === 1 ? 'service' : 'services' }} not included.</span>
    </span>

    <span
      v-if="overflow > 0"
      class="text-[10px] font-mono text-fg-faint"
      data-testid="agent-service-overflow"
      aria-hidden="true"
    >+{{ overflow }}</span>
  </span>
</template>
