<script setup lang="ts">
import type { DashboardAgentDTO } from '@/sdk.generated'
import type { Agent } from '@/types'
import { computed, ref } from 'vue'
import AgentGlyph from '@/components/ui/AgentGlyph.vue'
import { deletePersistentAgent, usePersistentAgents, withoutLiveSession } from '@/features/agents/composables/usePersistentAgents'
import { permissionModeShortLabel } from '@/utils/permissionModes'

/*
 * The agents this dashboard keeps that have no session running.
 *
 * The roster is built from live processes plus an in-process registry of
 * recently-finished ones, so restarting the server took every finished agent
 * off this page - a Resume Editor and a Portfolio Developer among them - even
 * though nothing had been deleted. An agent is a durable thing; it belongs here
 * until someone removes it, not until the server happens to restart.
 *
 * Nothing here pretends to be running. There is no state badge, no activity and
 * no metrics: these agents have no process, and the section says so once. What
 * they do have is their identity and their saved configuration, which is
 * exactly what makes them resumable.
 */
const props = defineProps<{
  /** The live roster, so an agent with a session is left to its own card. */
  agents: Agent[]
}>()

const { persistentAgents, loaded } = usePersistentAgents()
const busy = ref('')
const error = ref('')

const dormant = computed(() => withoutLiveSession(persistentAgents.value, props.agents))

async function remove(agent: DashboardAgentDTO) {
  busy.value = agent.agentId
  error.value = ''
  try {
    await deletePersistentAgent(agent.agentId)
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    busy.value = ''
  }
}

/** The folder's own name; the full path is a diagnostic, not a card heading. */
function folderName(cwd?: string): string {
  return cwd ? cwd.split('/').filter(Boolean).pop() ?? cwd : 'no folder recorded'
}
</script>

<template>
  <section
    v-if="loaded && dormant.length > 0"
    class="mb-4 flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-card px-4 py-3"
    aria-labelledby="persistent-agents-heading"
    data-testid="persistent-agents"
  >
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id="persistent-agents-heading" class="m-0 text-ui font-semibold text-fg">
        Agents with no session running
      </h2>
      <span class="text-ui-sm text-fg-mute" data-testid="persistent-agents-count">{{ dormant.length }} kept</span>
      <span class="text-ui-sm text-fg-mute">Their configuration is kept until you delete them. Open one to resume it.</span>
    </header>

    <ul class="m-0 flex list-none flex-col divide-y divide-line p-0" data-testid="persistent-agents-list">
      <li
        v-for="agent in dormant"
        :key="agent.agentId"
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2"
        data-testid="persistent-agent"
      >
        <AgentGlyph :agent="{ category: agent.category }" />
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-ui font-medium text-fg" data-testid="persistent-agent-name">{{ agent.displayName || 'Unnamed agent' }}</span>
          <span class="flex flex-wrap items-center gap-x-2 text-ui-sm text-fg-mute">
            <span data-testid="persistent-agent-folder">{{ folderName(agent.cwd) }}</span>
            <span v-if="agent.permissionMode" data-testid="persistent-agent-mode">· {{ permissionModeShortLabel(agent.permissionMode) }} next session</span>
            <span v-if="agent.hasInstructions" data-testid="persistent-agent-instructions">· has instructions</span>
          </span>
        </span>

        <button
          type="button"
          :disabled="busy === agent.agentId"
          class="ml-auto cursor-pointer rounded-lg border border-line bg-transparent px-3 py-1 text-ui-sm text-fg-mute hover:border-danger-line hover:bg-danger-soft hover:text-danger-text disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
          :data-testid="`persistent-agent-delete-${agent.agentId}`"
          @click="remove(agent)"
        >
          {{ busy === agent.agentId ? 'Deleting…' : 'Delete agent' }}
        </button>
      </li>
    </ul>

    <p class="m-0 text-ui-sm text-fg-mute" data-testid="persistent-agents-note">
      Deleting an agent removes what Agent Dashboard remembers about it. Its folder, your repository and its conversation history stay where they are.
    </p>
    <p v-if="error" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="persistent-agents-error">
      {{ error }}
    </p>
  </section>
</template>
