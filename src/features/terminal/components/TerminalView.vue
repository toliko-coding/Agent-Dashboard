<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { workspaceDisplay } from '@/utils/agentGroup'
import { agentTitle } from '@/utils/agentLabels'
import ViewPlaceholder from '../../../components/ViewPlaceholder.vue'
import { useAgents } from '../../agents'

/*
 * The terminal transport is per-process: it attaches to /api/agents/{pid}/terminal
 * over a WebSocket, so a terminal only exists in the context of a running agent.
 * There is no shell-on-the-server endpoint, and this view does not invent one.
 *
 * Kept for saved views and links; it is no longer a destination. What it can
 * honestly do is route the user to the agents that DO have a terminal: each
 * opens that agent's details, where its terminal action lives. Agents are named
 * the way every other surface names them, and located by repository and
 * workspace — never by folder or PID.
 *
 * Reads the agents stream the app already holds; it starts nothing of its own.
 */
const { agents, selectAgent } = useAgents({ autoStart: false })

// liveInjectable marks sessions with a pty broker / tmux backing, which is what
// the terminal socket needs.
const attachable = computed(() => agents.value.filter(a => a.liveInjectable))

function where(agent: Agent): string {
  const ws = agent.workspace
  if (!ws?.id)
    return 'Workspace unknown'
  const display = workspaceDisplay(ws)
  if (ws.kind === 'plain')
    return `${display.title} · ${display.kind}`
  return `${ws.repository?.name || 'Repository'} · ${display.title} · ${display.kind}`
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <ViewPlaceholder
      icon="▮"
      title="Terminals attach to a running agent"
      summary="There is no standalone server shell. A terminal session is opened against a specific agent process, from that agent's card or details."
      requires="Open an agent, then use its terminal (⌨) action"
    />

    <section v-if="attachable.length" aria-labelledby="terminal-agents-heading" class="flex flex-col gap-2">
      <h2 id="terminal-agents-heading" class="m-0 text-label font-semibold uppercase tracking-wider text-fg-mute">
        Agents with a terminal available
      </h2>
      <ul class="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-panel border border-line bg-card overflow-hidden">
        <li v-for="a in attachable" :key="a.sessionId">
          <button
            type="button"
            class="w-full flex items-baseline gap-3 px-3 py-2 text-left bg-transparent border-none cursor-pointer hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-accent"
            data-testid="terminal-agent"
            @click="selectAgent(a)"
          >
            <span class="text-ui font-semibold text-fg truncate">{{ agentTitle(a) }}</span>
            <span class="text-ui-sm text-fg-mute truncate" data-testid="terminal-agent-where">{{ where(a) }}</span>
            <span class="ml-auto text-ui-sm text-accent shrink-0">Open details</span>
          </button>
        </li>
      </ul>
    </section>
  </section>
</template>
