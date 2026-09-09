<script setup lang="ts">
import type { PanelState } from '../panelState'
import { computed } from 'vue'
import { useProjects } from '@/composables/useProjects'
import { useAgents } from '@/features/agents'
import { summarizeProjectAgents } from '@/utils/projectAgents'
import CockpitPanel from './CockpitPanel.vue'

/*
 * Compact project summary.
 *
 * Agent counts are derived by PATH CONTAINMENT (agent.cwd inside a registered
 * project folder) — never by matching projectName, which is only basename(cwd)
 * and collides across unrelated checkouts. A project with no registered folder
 * reports "—", not 0, because the association is unknowable rather than empty.
 *
 * Not shown, because the entity does not carry them: repository URL, localhost
 * port, runtime/framework, project status.
 */
const emit = defineEmits<{ navigate: [] }>()

const { projects, isLoading, error } = useProjects()
const { agents } = useAgents({ autoStart: false })

const rows = computed(() =>
  [...projects.value]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => ({ project: p, counts: summarizeProjectAgents(agents.value, p) })))

const state = computed<PanelState>(() => {
  if (error.value)
    return 'failed'
  if (isLoading.value && projects.value.length === 0)
    return 'loading'
  return projects.value.length === 0 ? 'empty' : 'ready'
})
</script>

<template>
  <CockpitPanel
    id="projects"
    title="Projects"
    :state="state"
    :message="error ?? 'No project registered yet.'"
  >
    <template #action>
      <button
        type="button"
        data-testid="projects-open-all"
        class="text-[11px] text-accent hover:underline rounded px-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        @click="emit('navigate')"
      >
        Open →
      </button>
    </template>

    <ul class="flex flex-col gap-1.5" data-testid="projects-summary">
      <li
        v-for="{ project, counts } in rows.slice(0, 6)"
        :key="project.id"
        class="flex items-center gap-2 text-[12px] min-w-0"
        :data-testid="`project-row-${project.id}`"
      >
        <span
          class="w-2 h-2 rounded-full shrink-0 border border-line"
          :style="project.color ? { backgroundColor: project.color } : undefined"
          aria-hidden="true"
        />
        <span class="truncate text-fg">{{ project.name }}</span>

        <!-- "—" means the project has no folder registered, so agents cannot be
             attributed to it. It is not a zero. -->
        <span
          v-if="counts.total === null"
          class="ml-auto shrink-0 text-[10px] text-fg-faint"
          :data-testid="`project-agents-unknown-${project.id}`"
          title="No folder registered, so agents cannot be associated"
        >— agents</span>
        <span
          v-else
          class="ml-auto shrink-0 text-[10px] font-mono text-fg-mute"
          :data-testid="`project-agents-${project.id}`"
        >
          {{ counts.active }}/{{ counts.total }} active
        </span>
      </li>
    </ul>
  </CockpitPanel>
</template>
