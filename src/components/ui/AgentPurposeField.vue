<script setup lang="ts">
import type { AgentPurpose } from '@/utils/agentPurpose'
import { AGENT_PURPOSES, DEFAULT_AGENT_PURPOSE } from '@/utils/agentPurpose'
import AgentGlyph from './AgentGlyph.vue'
import AppSelect from './AppSelect.vue'

/*
 * The one agent icon picker (3N.2.2): New Agent and Edit agent both use it, so
 * the categories, their labels and the preview exist once. Presentation only.
 */
defineProps<{ id: string, testid?: string }>()
const model = defineModel<AgentPurpose>({ required: true })

const options = AGENT_PURPOSES.map(p => ({ value: p.value, label: p.value === DEFAULT_AGENT_PURPOSE ? `${p.label} (default)` : p.label }))
</script>

<template>
  <div class="flex items-center gap-2">
    <AgentGlyph :purpose="model" />
    <AppSelect
      :id="id"
      :model-value="model"
      :options="options"
      :data-testid="testid"
      class="min-w-0 flex-1"
      @update:model-value="model = $event"
    />
  </div>
</template>
