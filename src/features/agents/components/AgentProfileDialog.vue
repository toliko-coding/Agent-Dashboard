<script setup lang="ts">
import type { AgentConfigDTO } from '@/sdk.generated'
import type { AgentPurpose } from '@/utils/agentPurpose'
import { computed, ref, watch } from 'vue'
import AgentPurposeField from '@/components/ui/AgentPurposeField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppFieldLabel from '@/components/ui/AppFieldLabel.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { updateAgentProfile, useAgentProfileEditor } from '@/composables/useAgentLifecycle'
import { fetchAgentConfig, saveAgentConfig } from '@/features/agents/composables/useAgentConfig'
import { useAgents } from '@/features/agents/composables/useAgents'
import { agentTitle } from '@/utils/agentLabels'
import { agentPurpose, DEFAULT_AGENT_PURPOSE } from '@/utils/agentPurpose'
import { isDangerousPermissionMode, PERMISSION_MODE_OPTIONS, permissionModeShortLabel } from '@/utils/permissionModes'

/*
 * Edit agent: what this agent is called, how it should work, and what it may do
 * without asking.
 *
 * The distinction the dialog exists to keep visible is agent vs session. An
 * agent is durable; a session is one Claude process. Claude reads its
 * permission mode and system prompt once, at startup, so nothing saved here
 * changes the session already running — it describes the next one, and the
 * Session behaviour section says so in as many words rather than leaving the
 * user to assume either way.
 *
 * Two stores, each written only when its own part changed. A name and an icon
 * are presentation and go to the profile route, which every surface already
 * reads. Instructions and a permission mode are configuration, go to the
 * agent's own record, and are offered only for an agent this dashboard started:
 * they are applied when it starts a session, so for a Terminal or VS Code
 * session there is nothing they could ever apply to.
 *
 * There is no main-agent control here. The role is seeded once on the server,
 * so no agent — Project Intelligence included — can be promoted from a dialog.
 */
const NAME_MAX = 60
const INSTRUCTIONS_MAX = 10000

const { editing, cancelEdit } = useAgentProfileEditor()
const { applyAgentProfile } = useAgents({ autoStart: false })

const name = ref('')
const category = ref<AgentPurpose>(DEFAULT_AGENT_PURPOSE)
const instructions = ref('')
const permissionMode = ref('')
const config = ref<AgentConfigDTO | null>(null)
const busy = ref(false)
const error = ref('')

watch(editing, (agent) => {
  busy.value = false
  error.value = ''
  config.value = null
  instructions.value = ''
  permissionMode.value = ''
  if (!agent)
    return
  name.value = agent.displayName ?? ''
  category.value = agentPurpose(agent)
  // The instructions text is not on the roster — it is read when something
  // actually shows it, which is here.
  void fetchAgentConfig(agent.pid)
    .then((loaded) => {
      if (editing.value?.pid !== agent.pid)
        return
      config.value = loaded
      instructions.value = loaded.instructions ?? ''
      permissionMode.value = loaded.permissionMode ?? ''
    })
    .catch(() => {
      // A configuration that cannot be read leaves the two fields absent rather
      // than showing blanks as though nothing were saved.
    })
}, { immediate: true })

/** False for a session this dashboard did not start: label it, never configure it. */
const configurable = computed(() => config.value?.configurableHere === true)
const dangerous = computed(() => isDangerousPermissionMode(permissionMode.value))
const tooLong = computed(() => [...name.value.trim()].length > NAME_MAX)
const instructionsTooLong = computed(() => [...instructions.value].length > INSTRUCTIONS_MAX)
// What the agent is called when the name is left empty.
const fallback = computed(() => editing.value ? agentTitle({ ...editing.value, displayName: undefined }) : '')

const modeOptions = computed(() => [
  { value: '', label: 'Not set — start with Claude’s default' },
  ...PERMISSION_MODE_OPTIONS,
])

/**
 * What the session in front of the user is running under, when that is known
 * and differs from what is saved. Only a real disagreement is worth a sentence.
 */
const runningMode = computed(() => config.value?.sessionPermissionMode ?? '')
const sessionRunning = computed(() => config.value?.sessionRunning === true)
const savedDiffers = computed(() => {
  const saved = permissionMode.value
  return !!saved && !!runningMode.value && saved !== runningMode.value
})

function close() {
  if (!busy.value)
    cancelEdit()
}

async function save() {
  const agent = editing.value
  if (!agent || busy.value || tooLong.value || instructionsTooLong.value)
    return
  busy.value = true
  error.value = ''
  try {
    const nextName = name.value.trim()
    const nextCategory = category.value === DEFAULT_AGENT_PURPOSE ? '' : category.value
    if (nextName !== (agent.displayName ?? '') || nextCategory !== (agent.category ?? '')) {
      const saved = await updateAgentProfile(agent.pid, { displayName: nextName, category: nextCategory })
      applyAgentProfile(agent.sessionId, saved)
    }
    // Configuration is a separate store and a separate right: it is written
    // only when it changed, and only where it could ever be applied.
    const current = config.value
    if (configurable.value && current
      && (instructions.value !== (current.instructions ?? '') || permissionMode.value !== (current.permissionMode ?? ''))) {
      config.value = await saveAgentConfig(agent.pid, {
        instructions: instructions.value,
        permissionMode: permissionMode.value,
      })
    }
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
  <AppModal :open="!!editing" :z-index="1200" width="560px" labelled-by="agent-profile-title" @close="close">
    <div v-if="editing" class="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-5" data-testid="agent-profile-dialog">
      <div class="flex flex-col gap-1">
        <h2 id="agent-profile-title" class="m-0 text-title font-semibold text-fg">
          Edit agent
        </h2>
        <p class="m-0 text-ui-sm text-fg-mute">
          What this agent is called, and how the next session it runs should work. Its session, folder, Project and ownership do not change.
        </p>
      </div>

      <section class="flex flex-col gap-1.5" aria-labelledby="agent-profile-identity-heading">
        <h3 id="agent-profile-identity-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
          Identity
        </h3>
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

        <AppFieldLabel for="agent-profile-icon">
          Icon
        </AppFieldLabel>
        <AgentPurposeField id="agent-profile-icon" v-model="category" testid="agent-profile-icon" />
      </section>

      <section class="flex flex-col gap-1.5" aria-labelledby="agent-profile-instructions-heading">
        <h3 id="agent-profile-instructions-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
          Instructions
        </h3>
        <AppFieldLabel for="agent-profile-instructions">
          Standing instructions
        </AppFieldLabel>
        <AppInput
          id="agent-profile-instructions"
          v-model="instructions"
          type="textarea"
          :rows="5"
          :disabled="!configurable"
          placeholder="How this agent should work. Sent as its system prompt when Agent Dashboard starts a session for it."
          data-testid="agent-profile-instructions"
        />
        <p v-if="instructionsTooLong" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="agent-profile-instructions-too-long">
          Instructions can be at most {{ INSTRUCTIONS_MAX }} characters.
        </p>
        <p v-else-if="!configurable" class="m-0 text-ui-sm text-fg-mute" data-testid="agent-profile-observe-only">
          Agent Dashboard did not start this session, so it is observed, not configured. Its name and icon can still be changed.
        </p>
        <p v-else class="m-0 text-ui-sm text-fg-mute">
          Applied when Agent Dashboard next starts or resumes this agent.
        </p>
      </section>

      <section class="flex flex-col gap-1.5" aria-labelledby="agent-profile-permissions-heading">
        <h3 id="agent-profile-permissions-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
          Permissions
        </h3>
        <AppFieldLabel for="agent-profile-permission-mode">
          Permission mode for the next session
        </AppFieldLabel>
        <AppSelect
          id="agent-profile-permission-mode"
          v-model="permissionMode"
          :options="modeOptions"
          :disabled="!configurable"
          data-testid="agent-profile-permission-mode"
          class="w-full"
        />
        <div
          v-if="dangerous"
          class="rounded-control border border-warning-line bg-card px-3 py-2 text-ui-sm leading-relaxed text-warning-text"
          data-testid="agent-profile-dangerous"
        >
          The next session will act on every tool call without asking — file writes, deletions, git operations and shell commands included. Agent Dashboard still never answers a prompt for you, and this changes nothing about the session running now.
        </div>
      </section>

      <section class="flex flex-col gap-1" aria-labelledby="agent-profile-session-heading">
        <h3 id="agent-profile-session-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
          Session behaviour
        </h3>
        <p v-if="!sessionRunning" class="m-0 text-ui-sm text-fg-mute" data-testid="agent-profile-session-note">
          No session is running. Resuming this agent starts one, and shows you this configuration first.
        </p>
        <template v-else>
          <p class="m-0 text-ui-sm text-fg-mute" data-testid="agent-profile-session-note">
            Current session: <span class="font-medium text-fg-soft">{{ runningMode ? permissionModeShortLabel(runningMode) : 'not observed' }}</span>.
            Saved for the next session: <span class="font-medium text-fg-soft">{{ permissionMode ? permissionModeShortLabel(permissionMode) : 'Claude’s default' }}</span>.
          </p>
          <p v-if="savedDiffers" class="m-0 text-ui-sm text-warning-text" data-testid="agent-profile-session-differs">
            They differ. Claude reads its permission mode once, at startup, so this session keeps what it started with until you resume or restart the agent.
          </p>
        </template>
      </section>

      <p v-if="error" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="agent-profile-error">
        {{ error }}
      </p>

      <footer class="flex justify-end gap-2">
        <AppButton variant="outline" :disabled="busy" data-testid="agent-profile-cancel" @click="close">
          Cancel
        </AppButton>
        <AppButton variant="primary" :disabled="busy || tooLong || instructionsTooLong" data-testid="agent-profile-save" @click="save">
          {{ busy ? 'Saving…' : 'Save' }}
        </AppButton>
      </footer>
    </div>
  </AppModal>
</template>
