<script setup lang="ts">
import type { PanelState } from '../panelState'
import type { ProjectRoadmapSummary } from '@/features/projects'
import { computed, onMounted, ref } from 'vue'
import { useProjects } from '@/composables/useProjects'
import { useRefreshWhenShown } from '@/composables/useRefreshWhenShown'
import { useAgents } from '@/features/agents'
import { fetchRoadmapSummaries, selectedProjectId, STATUS_GLYPHS } from '@/features/projects'
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

// Roadmap position per project (Phase 4B): read when Command opens and again
// when the window regains focus (Phase 4.1) — never polled. Until the first read
// lands nothing is shown, so a count is never a placeholder zero.
const roadmaps = ref<Map<string, ProjectRoadmapSummary>>(new Map())
function loadRoadmaps() {
  fetchRoadmapSummaries()
    .then((list) => { roadmaps.value = new Map(list.map(r => [r.projectId, r])) })
    .catch(() => {})
}
onMounted(loadRoadmaps)
useRefreshWhenShown(loadRoadmaps)
const blockedTotal = computed(() => [...roadmaps.value.values()].reduce((n, r) => n + r.summary.blocked, 0))
const withCurrent = computed(() => [...roadmaps.value.values()].filter(r => r.currentPhase).length)

function openRoadmap(projectId: string): void {
  selectedProjectId.value = projectId
  emit('navigate')
}

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
        class="text-ui-sm text-accent hover:underline rounded px-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        @click="emit('navigate')"
      >
        Open →
      </button>
    </template>

    <p v-if="roadmaps.size" class="m-0 mb-2 flex flex-wrap gap-x-3 text-ui-sm text-fg-mute" data-testid="projects-roadmap-counts">
      <span><span class="font-mono text-fg">{{ withCurrent }}</span> current {{ withCurrent === 1 ? 'milestone' : 'milestones' }}</span>
      <span v-if="blockedTotal" class="text-warning-text">⚠ {{ blockedTotal }} blocked</span>
    </p>
    <ul class="flex flex-col gap-1.5" data-testid="projects-summary">
      <li
        v-for="{ project, counts } in rows.slice(0, 6)"
        :key="project.id"
        class="flex items-center gap-2 text-ui-sm min-w-0"
        :data-testid="`project-row-${project.id}`"
      >
        <span
          class="w-2 h-2 rounded-full shrink-0 border border-line"
          :style="project.color ? { backgroundColor: project.color } : undefined"
          aria-hidden="true"
        />
        <span class="flex min-w-0 flex-col">
          <span class="truncate text-fg">{{ project.name }}</span>
          <button
            v-if="roadmaps.get(project.id)?.currentPhase"
            type="button"
            class="cursor-pointer truncate border-none bg-transparent p-0 text-left text-label text-live-text hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent rounded"
            :data-testid="`project-current-${project.id}`"
            :aria-label="`Open ${project.name} roadmap, current phase ${roadmaps.get(project.id)!.currentPhase}`"
            @click="openRoadmap(project.id)"
          >◉ {{ roadmaps.get(project.id)!.currentPhase }}<template v-if="roadmaps.get(project.id)!.summary.blocked"> · {{ STATUS_GLYPHS.blocked }} {{ roadmaps.get(project.id)!.summary.blocked }} blocked</template></button>
        </span>

        <!-- "—" means the project has no folder registered, so agents cannot be
             attributed to it. It is not a zero. -->
        <span
          v-if="counts.total === null"
          class="ml-auto shrink-0 text-label text-fg-faint"
          :data-testid="`project-agents-unknown-${project.id}`"
          title="No folder registered, so agents cannot be associated"
        >— agents</span>
        <span
          v-else
          class="ml-auto shrink-0 text-label font-mono text-fg-mute"
          :data-testid="`project-agents-${project.id}`"
        >
          {{ counts.active }}/{{ counts.total }} active
        </span>
      </li>
    </ul>
  </CockpitPanel>
</template>
