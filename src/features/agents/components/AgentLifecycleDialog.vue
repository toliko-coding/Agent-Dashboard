<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AgentGlyph from '@/components/ui/AgentGlyph.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { agentIsRunning, deleteAgent, resumeUnderDashboard, stopAgent, useAgentLifecycle } from '@/composables/useAgentLifecycle'
import { useAgents } from '@/features/agents/composables/useAgents'
import { agentTitle } from '@/utils/agentLabels'

/*
 * The one confirmation for stopping or deleting an agent (3N.2), mounted once.
 *
 * Delete says exactly what it does and does not do: the agent leaves the
 * dashboard; its folder, Git repository and Claude history stay. A running
 * agent is stopped first, and the dialog says so before the user confirms —
 * the server refuses to stop it otherwise.
 */
const { pending, cancel } = useAgentLifecycle()
const { selectedAgent, selectAgent, dismissAgent, selectAgentWhenAvailable } = useAgents({ autoStart: false })

const busy = ref(false)
const error = ref('')

const agent = computed(() => pending.value?.agent ?? null)
const action = computed(() => pending.value?.action ?? 'delete')
const name = computed(() => agent.value ? agentTitle(agent.value) : '')
const running = computed(() => agent.value ? agentIsRunning(agent.value) : false)
const endsRunningSession = computed(() => pending.value?.endsRunningSession === true)

const TITLES = { stop: 'Stop', delete: 'Delete', resume: 'Resume' } as const
const CONFIRM = { stop: ['Stop Agent', 'Stopping…'], delete: ['Delete Agent', 'Deleting…'], resume: ['Resume under Dashboard', 'Resuming…'] } as const

watch(pending, () => {
  busy.value = false
  error.value = ''
})

function close() {
  if (!busy.value)
    cancel()
}

async function confirm() {
  const a = agent.value
  if (!a || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    if (action.value === 'stop') {
      await stopAgent(a.pid)
    }
    else if (action.value === 'resume') {
      const resumed = await resumeUnderDashboard(a.pid)
      const wasOpen = selectedAgent.value?.pid === a.pid
      dismissAgent(a.pid)
      if (wasOpen)
        selectAgentWhenAvailable?.(resumed.pid)
    }
    else {
      await deleteAgent(a.pid, running.value)
      if (selectedAgent.value?.pid === a.pid)
        selectAgent(null)
      dismissAgent(a.pid)
    }
    busy.value = false
    cancel()
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}
</script>

<template>
  <AppModal :open="!!agent" :z-index="1200" labelled-by="agent-lifecycle-title" @close="close">
    <div v-if="agent" class="flex flex-col gap-4 p-5" data-testid="agent-lifecycle-dialog" :data-action="action">
      <div class="flex items-center gap-3">
        <AgentGlyph :agent="agent" />
        <h2 id="agent-lifecycle-title" class="m-0 text-title font-semibold text-fg">
          {{ action === 'resume' ? `Resume “${name}” under Agent Dashboard?` : `${TITLES[action]} “${name}”?` }}
        </h2>
      </div>

      <div class="flex flex-col gap-2 text-ui text-fg-soft" data-testid="agent-lifecycle-explanation">
        <template v-if="action === 'resume'">
          <p v-if="endsRunningSession" class="m-0">
            Agent Dashboard will type <code class="font-mono">/exit</code> into this session, wait for it to end, then resume the same conversation as a new process it manages.
          </p>
          <p v-else class="m-0">
            Agent Dashboard will resume this conversation as a new process it manages.
          </p>
          <p v-if="endsRunningSession" class="m-0 font-medium text-warning-text" data-testid="agent-lifecycle-interrupts">
            Anything the agent is doing right now is interrupted.
          </p>
          <p class="m-0">
            It runs in the same folder with the default permission mode. The conversation history, name, icon and your files are kept, and Stop and Delete become available.
          </p>
        </template>
        <template v-else-if="action === 'stop'">
          <p class="m-0">
            Its running Claude process will end.
          </p>
          <p class="m-0">
            The session history and your project files are kept. You can continue the session later by sending it a message.
          </p>
        </template>
        <template v-else>
          <p class="m-0">
            This removes the agent from Agent Dashboard.
          </p>
          <p v-if="running" class="m-0 font-medium text-warning-text" data-testid="agent-lifecycle-stops">
            It is running: its Claude process will be stopped first.
          </p>
          <p class="m-0">
            Your project files and Git repository will not be deleted, and the Claude session history is kept.
          </p>
        </template>
      </div>

      <p v-if="error" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="agent-lifecycle-error">
        {{ error }}
      </p>

      <footer class="flex justify-end gap-2">
        <AppButton variant="outline" :disabled="busy" data-testid="agent-lifecycle-cancel" @click="close">
          Cancel
        </AppButton>
        <AppButton :variant="action === 'resume' ? 'primary' : 'danger'" :disabled="busy" data-testid="agent-lifecycle-confirm" @click="confirm">
          {{ CONFIRM[action][busy ? 1 : 0] }}
        </AppButton>
      </footer>
    </div>
  </AppModal>
</template>
