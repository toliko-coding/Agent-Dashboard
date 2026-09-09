<script setup lang="ts">
import { computed } from 'vue'
import ViewPlaceholder from '../../../components/ViewPlaceholder.vue'
import { useAgents } from '../../agents'

/*
 * The terminal transport is per-process: it attaches to /api/agents/{pid}/terminal
 * over a WebSocket, so a terminal only exists in the context of a running agent.
 * There is no shell-on-the-server endpoint, and this view does not invent one.
 *
 * What it can honestly do is route the user to the agents that DO have a
 * terminal available.
 */
const { agents } = useAgents({ autoStart: false })

// liveInjectable marks sessions with a pty broker / tmux backing, which is what
// the terminal socket needs.
const attachable = computed(() => agents.value.filter(a => a.liveInjectable))
</script>

<template>
  <section class="flex flex-col gap-4">
    <ViewPlaceholder
      icon="▮"
      title="Terminals attach to a running agent"
      summary="There is no standalone server shell. A terminal session is opened against a specific agent process, from that agent's card."
      requires="Open an agent, then use its terminal (⌨) action"
    />

    <div v-if="attachable.length" class="flex flex-col gap-2">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Agents with a terminal available
      </h3>
      <ul class="flex flex-col gap-1">
        <li
          v-for="a in attachable"
          :key="a.sessionId"
          class="flex items-center gap-2 border border-line rounded-md bg-card px-3 py-2"
        >
          <span class="text-[12px] text-fg truncate">{{ a.projectName }}</span>
          <span class="text-[10px] font-mono text-fg-faint">pid {{ a.pid }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
