<script setup lang="ts">
import { computed } from 'vue'
import { answerFolderTrust, useSpawnWatch } from '../composables/useSpawnWatch'
import AppButton from './ui/AppButton.vue'

/*
 * The explicit decision surface for Claude Code's own folder trust question
 * (3M). Shown in the New Agent dialog, and from Needs you once it has closed.
 *
 * It states exactly what Claude is asking — the full folder path, and what
 * trusting it lets Claude do — because this is where the user decides. Nothing
 * here answers on its own: each button is one explicit decision, and the server
 * delivers it only while Claude's question is open for this very folder, and
 * only once — a second browser's answer is refused.
 *
 * The question itself is server-owned (useAgents().pendingFolderTrust).
 */
const props = defineProps<{ trust: { pid: number, path: string } }>()

const { answerStateFor } = useSpawnWatch()
const state = computed(() => answerStateFor(props.trust.pid))
</script>

<template>
  <section
    :aria-labelledby="`folder-trust-heading-${trust.pid}`"
    class="flex flex-col gap-3 rounded-panel border border-warning-line bg-card p-4"
    data-testid="folder-trust-decision"
  >
    <h3 :id="`folder-trust-heading-${trust.pid}`" class="m-0 text-body font-semibold text-fg">
      Claude asks whether to trust this folder
    </h3>
    <p class="m-0 text-ui text-fg-soft">
      Claude Code stopped before starting its session and is waiting for your answer. If you trust the folder, Claude Code will be able to read, edit, and execute files in it.
    </p>
    <div class="flex flex-col gap-1">
      <span class="field-label">Folder</span>
      <span class="break-all rounded-control bg-recessed px-3 py-2 font-mono text-ui-sm text-fg" data-testid="folder-trust-path">{{ trust.path }}</span>
    </div>
    <p class="m-0 text-ui-sm text-fg-mute">
      The dashboard never answers this for you. Allowing a folder for agents is not the same as trusting it in Claude.
    </p>
    <p v-if="state.error" role="alert" class="m-0 text-ui-sm text-danger-text" data-testid="folder-trust-error">
      {{ state.error }}
    </p>
    <div class="flex flex-wrap justify-end gap-2">
      <AppButton
        variant="secondary"
        :disabled="state.answering"
        data-testid="folder-trust-exit"
        @click="answerFolderTrust(trust.pid, 'exit')"
      >
        Don't trust — stop the agent
      </AppButton>
      <AppButton
        variant="primary"
        :disabled="state.answering"
        data-testid="folder-trust-trust"
        @click="answerFolderTrust(trust.pid, 'trust')"
      >
        Trust this folder
      </AppButton>
    </div>
  </section>
</template>
