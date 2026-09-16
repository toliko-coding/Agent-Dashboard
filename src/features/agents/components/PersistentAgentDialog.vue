<script setup lang="ts">
import type { DashboardAgentConfigDTO } from '@/sdk.generated'
import type { AgentPurpose } from '@/utils/agentPurpose'
import { computed, ref, watch } from 'vue'
import AgentPurposeField from '@/components/ui/AgentPurposeField.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppFieldLabel from '@/components/ui/AppFieldLabel.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppModal from '@/components/ui/AppModal.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { useProjects } from '@/composables/useProjects'
import {
  deletePersistentAgent,
  fetchPersistentAgentConfig,
  savePersistentAgentConfig,
  startPersistentAgent,
} from '@/features/agents/composables/usePersistentAgents'
import { agentPurpose, DEFAULT_AGENT_PURPOSE } from '@/utils/agentPurpose'
import { isDangerousPermissionMode, PERMISSION_MODE_OPTIONS } from '@/utils/permissionModes'

/*
 * An agent with no session running, opened.
 *
 * The agent is the durable thing and the session is one Claude process, so this
 * surface is about the agent: what it is called, where it works, what it may do
 * without asking, and what it should be told. None of it describes a process,
 * because there is none - which is exactly why the page could show nothing
 * useful about these agents before.
 *
 * Starting and resuming are not the same act and are not presented as one. The
 * choice is made from what is on disk: if Claude still holds the transcript of
 * the agent's last session, this continues that conversation; if it does not -
 * pruned, or never run - it starts a new one and says so. The button never
 * says "Resume" over an empty session.
 *
 * Whichever it is, the agent keeps its identity: the server points this same
 * record at the new session rather than creating a second agent with the same
 * name and folder.
 */
const props = defineProps<{ agentId: string | null }>()
const emit = defineEmits<{ close: [], deleted: [agentId: string], started: [pid: number] }>()

const NAME_MAX = 60
const INSTRUCTIONS_MAX = 10000

// Read-only here: opening an agent must not start a stream as a side effect.
const { projects } = useProjects({ autoStart: false })

const config = ref<DashboardAgentConfigDTO | null>(null)
const name = ref('')
const category = ref<AgentPurpose>(DEFAULT_AGENT_PURPOSE)
const instructions = ref('')
const permissionMode = ref('')
const firstMessage = ref('')
const busy = ref(false)
const loadFailed = ref(false)
const error = ref('')

watch(() => props.agentId, (id) => {
  config.value = null
  loadFailed.value = false
  error.value = ''
  busy.value = false
  firstMessage.value = ''
  if (!id)
    return
  void fetchPersistentAgentConfig(id)
    .then((loaded) => {
      if (props.agentId !== id)
        return
      config.value = loaded
      name.value = loaded.displayName ?? ''
      category.value = agentPurpose({ category: loaded.category })
      instructions.value = loaded.instructions ?? ''
      permissionMode.value = loaded.permissionMode ?? ''
    })
    .catch(() => {
      if (props.agentId === id)
        loadFailed.value = true
    })
}, { immediate: true })

/** Resuming continues a conversation; starting begins one. Never guessed. */
const resuming = computed(() => config.value?.resumable === true)
const startLabel = computed(() => resuming.value ? 'Resume agent' : 'Start agent')
const startNote = computed(() => {
  if (resuming.value)
    return 'Continues the conversation from its last session.'
  return config.value?.sessionId
    ? 'Starts a new conversation. Its last session’s transcript is no longer on disk, so there is nothing to continue.'
    : 'Starts a new conversation. This agent has not run a session yet.'
})

const projectName = computed(() => {
  const id = config.value?.projectId
  if (!id)
    return ''
  return projects.value.find(p => p.id === id)?.name ?? id
})

const dangerous = computed(() => isDangerousPermissionMode(permissionMode.value))
const tooLong = computed(() => [...name.value.trim()].length > NAME_MAX)
const instructionsTooLong = computed(() => [...instructions.value].length > INSTRUCTIONS_MAX)
const canStart = computed(() => !!config.value && firstMessage.value.trim().length > 0 && !busy.value)

const modeOptions = computed(() => [
  { value: '', label: 'Not set — start with Claude’s default' },
  ...PERMISSION_MODE_OPTIONS,
])

function close() {
  if (!busy.value)
    emit('close')
}

async function save(): Promise<DashboardAgentConfigDTO | null> {
  const current = config.value
  if (!current)
    return null
  const nextName = name.value.trim()
  const nextCategory = category.value === DEFAULT_AGENT_PURPOSE ? '' : category.value
  const unchanged = nextName === (current.displayName ?? '')
    && nextCategory === (current.category ?? '')
    && instructions.value === (current.instructions ?? '')
    && permissionMode.value === (current.permissionMode ?? '')
  if (unchanged)
    return current
  const saved = await savePersistentAgentConfig(current.agentId, {
    displayName: nextName,
    category: nextCategory,
    instructions: instructions.value,
    permissionMode: permissionMode.value,
  })
  config.value = { ...saved, resumable: current.resumable, sessionId: current.sessionId }
  return config.value
}

async function saveOnly() {
  if (busy.value || tooLong.value || instructionsTooLong.value)
    return
  busy.value = true
  error.value = ''
  try {
    await save()
    busy.value = false
    emit('close')
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}

/*
 * Saving first, so the session starts with what the dialog shows rather than
 * with what was stored before it was edited.
 */
async function startOrResume() {
  if (!canStart.value || tooLong.value || instructionsTooLong.value)
    return
  busy.value = true
  error.value = ''
  try {
    const current = await save()
    if (!current)
      throw new Error('This agent could not be read, so nothing was started.')
    const { pid } = await startPersistentAgent(current, firstMessage.value.trim())
    busy.value = false
    emit('started', pid)
    emit('close')
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}

async function remove() {
  const current = config.value
  if (!current || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    await deletePersistentAgent(current.agentId)
    busy.value = false
    emit('deleted', current.agentId)
    emit('close')
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    busy.value = false
  }
}
</script>

<template>
  <AppModal :open="!!agentId" :z-index="1200" width="560px" labelled-by="persistent-agent-title" @close="close">
    <div class="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-5" data-testid="persistent-agent-dialog">
      <div class="flex flex-col gap-1">
        <h2 id="persistent-agent-title" class="m-0 text-title font-semibold text-fg">
          {{ config?.displayName || 'Agent' }}
        </h2>
        <p class="m-0 text-ui-sm text-fg-mute" data-testid="persistent-agent-status">
          No session running. This agent is kept until you delete it.
        </p>
      </div>

      <p v-if="loadFailed" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="persistent-agent-load-failed">
        This agent could not be read, so nothing is shown rather than blanks that would look like nothing is saved.
      </p>

      <template v-else-if="config">
        <section class="flex flex-col gap-1.5" aria-labelledby="persistent-agent-identity-heading">
          <h3 id="persistent-agent-identity-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
            Identity
          </h3>
          <AppFieldLabel for="persistent-agent-name">
            Name
          </AppFieldLabel>
          <AppInput id="persistent-agent-name" v-model="name" data-testid="persistent-agent-name-input" />
          <p v-if="tooLong" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="persistent-agent-name-too-long">
            A name can be at most {{ NAME_MAX }} characters.
          </p>
          <AppFieldLabel for="persistent-agent-icon">
            Icon
          </AppFieldLabel>
          <AgentPurposeField id="persistent-agent-icon" v-model="category" testid="persistent-agent-icon" />

          <AppFieldLabel for="persistent-agent-folder">
            Working folder
          </AppFieldLabel>
          <p id="persistent-agent-folder" class="m-0 break-all font-mono text-ui-sm text-fg-soft" data-testid="persistent-agent-folder-path">
            {{ config.cwd || 'No folder recorded — this agent cannot be started until it has one.' }}
          </p>
          <template v-if="projectName">
            <AppFieldLabel for="persistent-agent-project">
              Project
            </AppFieldLabel>
            <p id="persistent-agent-project" class="m-0 text-ui-sm text-fg-soft" data-testid="persistent-agent-project">
              {{ projectName }}
            </p>
          </template>
        </section>

        <section class="flex flex-col gap-1.5" aria-labelledby="persistent-agent-instructions-heading">
          <h3 id="persistent-agent-instructions-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
            Instructions
          </h3>
          <AppFieldLabel for="persistent-agent-instructions">
            Standing instructions
          </AppFieldLabel>
          <AppInput
            id="persistent-agent-instructions"
            v-model="instructions"
            type="textarea"
            :rows="5"
            placeholder="How this agent should work. Sent as its system prompt when Agent Dashboard starts a session for it."
            data-testid="persistent-agent-instructions"
          />
          <p v-if="instructionsTooLong" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="persistent-agent-instructions-too-long">
            Instructions can be at most {{ INSTRUCTIONS_MAX }} characters.
          </p>
        </section>

        <section class="flex flex-col gap-1.5" aria-labelledby="persistent-agent-permissions-heading">
          <h3 id="persistent-agent-permissions-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
            Permissions
          </h3>
          <AppFieldLabel for="persistent-agent-permission-mode">
            Permission mode for the next session
          </AppFieldLabel>
          <AppSelect
            id="persistent-agent-permission-mode"
            v-model="permissionMode"
            :options="modeOptions"
            data-testid="persistent-agent-permission-mode"
            class="w-full"
          />
          <div
            v-if="dangerous"
            class="rounded-control border border-warning-line bg-card px-3 py-2 text-ui-sm leading-relaxed text-warning-text"
            data-testid="persistent-agent-dangerous"
          >
            The next session will act on every tool call without asking — file writes, deletions, git operations and shell commands included. Agent Dashboard still never answers a prompt for you.
          </div>
        </section>

        <section class="flex flex-col gap-1.5" aria-labelledby="persistent-agent-start-heading">
          <h3 id="persistent-agent-start-heading" class="m-0 text-ui-sm font-semibold text-fg-soft">
            {{ startLabel }}
          </h3>
          <p class="m-0 text-ui-sm text-fg-mute" data-testid="persistent-agent-start-note">
            {{ startNote }}
          </p>
          <AppFieldLabel for="persistent-agent-first-message">
            First message
          </AppFieldLabel>
          <AppInput
            id="persistent-agent-first-message"
            v-model="firstMessage"
            type="textarea"
            :rows="3"
            placeholder="What should it do?"
            data-testid="persistent-agent-first-message"
          />
          <p class="m-0 text-ui-sm text-fg-mute">
            A session starts with a message, so this is what it is asked to do.
          </p>
        </section>
      </template>

      <p v-if="error" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="persistent-agent-error">
        {{ error }}
      </p>

      <footer class="flex flex-wrap items-center justify-end gap-2">
        <AppButton
          variant="outline"
          :disabled="busy || !config"
          class="mr-auto"
          data-testid="persistent-agent-delete"
          @click="remove"
        >
          Delete agent
        </AppButton>
        <AppButton variant="outline" :disabled="busy" data-testid="persistent-agent-cancel" @click="close">
          Cancel
        </AppButton>
        <AppButton
          variant="outline"
          :disabled="busy || !config || tooLong || instructionsTooLong"
          data-testid="persistent-agent-save"
          @click="saveOnly"
        >
          Save
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="!canStart || tooLong || instructionsTooLong"
          data-testid="persistent-agent-start"
          @click="startOrResume"
        >
          {{ busy ? 'Working…' : startLabel }}
        </AppButton>
      </footer>
    </div>
  </AppModal>
</template>
