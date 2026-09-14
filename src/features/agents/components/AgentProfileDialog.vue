<script setup lang="ts">
import type { AgentPurpose } from '@/utils/agentPurpose'
import { computed, ref, watch } from 'vue'
import AgentPurposeField from '@/components/ui/AgentPurposeField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppFieldLabel from '@/components/ui/AppFieldLabel.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { updateAgentProfile, useAgentProfileEditor } from '@/composables/useAgentLifecycle'
import { useAgents } from '@/features/agents/composables/useAgents'
import { agentTitle } from '@/utils/agentLabels'
import { agentPurpose, DEFAULT_AGENT_PURPOSE } from '@/utils/agentPurpose'

/*
 * Edit agent (3N.2.2), mounted once: an agent's name and icon, the presentation
 * metadata New Agent sets, saved by session id. Nothing else changes — not the
 * session, folder, repository, Project, ownership, permissions or trust — and
 * the folder is never renamed. The saved values apply at once on every surface
 * (they come from the same agent state) and the next stream frame confirms them.
 */
const NAME_MAX = 60

const { editing, cancelEdit } = useAgentProfileEditor()
const { applyAgentProfile } = useAgents({ autoStart: false })

const name = ref('')
const category = ref<AgentPurpose>(DEFAULT_AGENT_PURPOSE)
const busy = ref(false)
const error = ref('')

watch(editing, (agent) => {
  busy.value = false
  error.value = ''
  if (agent) {
    name.value = agent.displayName ?? ''
    category.value = agentPurpose(agent)
  }
}, { immediate: true })

const tooLong = computed(() => [...name.value.trim()].length > NAME_MAX)
// What the agent is called when the name is left empty.
const fallback = computed(() => editing.value ? agentTitle({ ...editing.value, displayName: undefined }) : '')

function close() {
  if (!busy.value)
    cancelEdit()
}

async function save() {
  const agent = editing.value
  if (!agent || busy.value || tooLong.value)
    return
  busy.value = true
  error.value = ''
  try {
    const saved = await updateAgentProfile(agent.pid, {
      displayName: name.value.trim(),
      category: category.value === DEFAULT_AGENT_PURPOSE ? '' : category.value,
    })
    applyAgentProfile(agent.sessionId, saved)
    busy.value = false
    cancelEdit()
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}
</script>

<template>
  <AppModal :open="!!editing" :z-index="1200" width="460px" labelled-by="agent-profile-title" @close="close">
    <div v-if="editing" class="flex flex-col gap-4 p-5" data-testid="agent-profile-dialog">
      <div class="flex flex-col gap-1">
        <h2 id="agent-profile-title" class="m-0 text-title font-semibold text-fg">
          Edit agent
        </h2>
        <p class="m-0 text-ui-sm text-fg-mute">
          How Agent Dashboard shows this agent. Its session, folder, Project and permissions do not change.
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="agent-profile-name">
          Name
        </AppFieldLabel>
        <AppInput
          id="agent-profile-name"
          v-model="name"
          :placeholder="fallback"
          data-testid="agent-profile-name"
          @keydown.enter.prevent="save"
        />
        <p v-if="tooLong" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="agent-profile-name-too-long">
          A name can be at most {{ NAME_MAX }} characters.
        </p>
        <p v-else class="m-0 text-ui-sm text-fg-mute">
          Leave it empty to show the Claude session title.
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="agent-profile-icon">
          Icon
        </AppFieldLabel>
        <AgentPurposeField id="agent-profile-icon" v-model="category" testid="agent-profile-icon" />
      </div>

      <p v-if="error" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="agent-profile-error">
        {{ error }}
      </p>

      <footer class="flex justify-end gap-2">
        <AppButton variant="outline" :disabled="busy" data-testid="agent-profile-cancel" @click="close">
          Cancel
        </AppButton>
        <AppButton variant="primary" :disabled="busy || tooLong" data-testid="agent-profile-save" @click="save">
          {{ busy ? 'Saving…' : 'Save' }}
        </AppButton>
      </footer>
    </div>
  </AppModal>
</template>
