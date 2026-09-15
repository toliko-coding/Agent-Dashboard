<script setup lang="ts">
import type { Agent } from '@/types'
import { defineAsyncComponent } from 'vue'
import AppModal from '@/components/ui/AppModal.vue'
import { agentTitle } from '@/utils/agentLabels'

/*
 * Claude's own terminal for a session Agent Dashboard launched (Phase 4.1.1).
 * What the user types goes straight to that session — including the answer to
 * a permission prompt, which the dashboard never chooses for them. Callers show
 * it only when agentTerminalAttachable(agent); the server enforces the same.
 */
defineProps<{ agent: Agent, open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const AgentTerminal = defineAsyncComponent(() => import('./AgentTerminal.vue'))
</script>

<template>
  <AppModal
    :open="open"
    :z-index="1150"
    :labelled-by="`agent-terminal-title-${agent.sessionId}`"
    @close="emit('close')"
  >
    <div class="flex flex-shrink-0 items-center justify-between gap-3 bg-raised px-4 py-2.5" @click.stop>
      <span class="flex min-w-0 flex-col">
        <span :id="`agent-terminal-title-${agent.sessionId}`" class="text-sm font-semibold text-fg">
          Terminal — {{ agentTitle(agent) }}
        </span>
        <span class="text-ui-sm text-fg-mute" data-testid="agent-terminal-hint">
          Keys you type go to Claude. Answer any prompt yourself, then close this window to return.
        </span>
      </span>
      <button
        type="button"
        aria-label="Close terminal"
        class="cursor-pointer rounded border-none bg-transparent px-2 py-1 text-base text-fg-mute hover:bg-raised hover:text-fg"
        @click.stop="emit('close')"
      >
        ✕
      </button>
    </div>
    <div data-testid="agent-terminal-modal" class="min-h-0 flex-1" @click.stop>
      <AgentTerminal v-if="open" :key="agent.pid" :pid="agent.pid" />
    </div>
  </AppModal>
</template>
