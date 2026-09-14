<script setup lang="ts">
import type { ProjectlessRoot } from '@/composables/useAgentLifecycle'
import { onMounted, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppFieldLabel from '@/components/ui/AppFieldLabel.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { getProjectlessRoot, setProjectlessRoot } from '@/composables/useAgentLifecycle'
import { errorMessage } from '@/utils/errorMessage'

/*
 * Settings → Agent folders (3N.2): where New Agent creates a workspace for an
 * agent that has no repository.
 *
 * The rules are the server's (services/projectless.go); this page states them.
 * The folder is not a permission: only each created workspace is allowed for
 * agents, Claude Code still asks whether to trust it, and changing this path
 * moves nothing that already exists.
 */
const current = ref<ProjectlessRoot | null>(null)
const draft = ref('')
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const saved = ref('')

onMounted(async () => {
  try {
    current.value = await getProjectlessRoot()
    draft.value = current.value.isDefault ? '' : current.value.root
  }
  catch (e) {
    error.value = errorMessage(e, 'Could not read the projectless agents folder')
  }
  finally {
    loading.value = false
  }
})

async function save(root: string) {
  saving.value = true
  error.value = ''
  saved.value = ''
  try {
    current.value = await setProjectlessRoot(root)
    draft.value = current.value.isDefault ? '' : current.value.root
    saved.value = current.value.isDefault ? 'Using the default folder.' : 'Saved.'
  }
  catch (e) {
    error.value = errorMessage(e, 'Could not save the projectless agents folder')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-5" data-testid="projectless-root-settings">
    <header class="flex flex-col gap-1">
      <h2 class="m-0 text-title font-semibold text-fg">
        Agent folders
      </h2>
      <p class="m-0 field-help">
        Where New Agent creates a workspace for an agent that is not about an existing repository.
      </p>
    </header>

    <section class="flex flex-col gap-2">
      <AppFieldLabel for="projectless-root">
        Projectless agents folder
      </AppFieldLabel>
      <p v-if="loading" class="m-0 field-help">
        Loading…
      </p>
      <p v-else-if="current" class="m-0 text-ui-sm text-fg-soft" data-testid="projectless-root-current">
        Currently <span class="font-mono text-fg">{{ current.root }}</span>
        <span v-if="current.isDefault" class="text-fg-mute"> (default)</span>
        <span v-if="!current.exists" class="text-fg-mute"> — created when the first workspace is</span>
      </p>
      <AppInput
        id="projectless-root"
        v-model="draft"
        :placeholder="current?.isDefault ? current.root : 'Absolute path, e.g. /Users/you/Documents/AI-Agents'"
        spellcheck="false"
        autocomplete="off"
        data-testid="projectless-root-input"
      />
      <p class="m-0 field-help">
        A new projectless workspace is a plain folder named after the agent inside this folder — for example
        <span class="font-mono">Resume-Editor</span>. Leave the field empty to use the default.
      </p>
      <ul class="m-0 flex list-disc flex-col gap-1 pl-5 field-help" data-testid="projectless-root-rules">
        <li>Changing it does not move existing agent folders; agents already in them keep working.</li>
        <li>Only each workspace the dashboard creates is allowed for agents — never this whole folder — and Claude Code still asks whether to trust it.</li>
        <li>Sensitive locations such as ~/.ssh, ~/.aws, ~/.gnupg, ~/.config and ~/.claude, and your home folder itself, cannot be used.</li>
      </ul>
      <div class="flex flex-wrap items-center gap-2">
        <AppButton :disabled="saving || loading" data-testid="projectless-root-save" @click="save(draft.trim())">
          {{ saving ? 'Saving…' : 'Save' }}
        </AppButton>
        <AppButton
          v-if="current && !current.isDefault"
          variant="outline"
          :disabled="saving"
          data-testid="projectless-root-default"
          @click="save('')"
        >
          Use default
        </AppButton>
        <span v-if="saved" class="text-ui-sm text-fg-mute" role="status" data-testid="projectless-root-saved">{{ saved }}</span>
      </div>
      <p v-if="error" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="projectless-root-error">
        {{ error }}
      </p>
    </section>
  </div>
</template>
