<script setup lang="ts">
import type { RoadmapStatus } from './roadmapModel'
import type { Project } from '@/types'
import { computed, onMounted, ref, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useAgents } from '@/features/agents'
import { attentionFor } from '@/utils/attention'
import { agentsForProject } from '@/utils/projectAgents'
import RoadmapMap from './RoadmapMap.vue'
import { currentPhase, nextPhase, overallLabel, progressLabel, STATUS_GLYPHS, STATUS_LABELS } from './roadmapModel'
import RoadmapPhaseDetail from './RoadmapPhaseDetail.vue'
import RoadmapProposals from './RoadmapProposals.vue'
import { useRoadmap } from './useRoadmap'

const props = defineProps<{ project: Project }>()

const emit = defineEmits<{ back: [] }>()

/*
 * Project Intelligence (Phase 4B): open a project and see, in order, what it
 * is, where it is now, what is done and what comes next — then the mission map,
 * the selected phase in detail, and AI proposals to review.
 *
 * Everything shown is the roadmap's own data (user, suggested or verified),
 * the agents stream, and the project's folders. Nothing is estimated: without
 * items there is no percentage, and "you are here" is the explicit current
 * phase.
 */
const PATH_SEPARATOR = /[\\/]/

const rm = useRoadmap(() => props.project.id)
const { roadmap, proposals, loading, busy, error } = rm
const { agents } = useAgents({ autoStart: false })

const projectAgents = computed(() => agentsForProject(agents.value, props.project).filter(a => !a.internalProcess))
const working = computed(() => projectAgents.value.some(a => a.working && a.status !== 'finished'))
const needsYou = computed(() => projectAgents.value.some(a => attentionFor(a) !== null))
const workspaces = computed(() => (props.project.folders ?? []).map(f => f.path.split(PATH_SEPARATOR).filter(Boolean).pop() ?? f.path))

const current = computed(() => currentPhase(roadmap.value))
const next = computed(() => roadmap.value ? nextPhase(roadmap.value) : null)
const selectedId = ref<string | null>(null)
const selected = computed(() => roadmap.value?.phases.find(p => p.id === selectedId.value) ?? null)

watch(roadmap, (value) => {
  if (!value)
    return
  if (!selectedId.value || !value.phases.some(p => p.id === selectedId.value))
    selectedId.value = value.currentPhaseId ?? value.phases[0]?.id ?? null
})

onMounted(() => {
  void rm.load()
  void rm.loadProposals()
})
watch(() => props.project.id, () => {
  selectedId.value = null
  void rm.load()
  void rm.loadProposals()
})

// Objective editing
const editingObjective = ref(false)
const objectiveDraft = ref('')
function editObjective() {
  objectiveDraft.value = roadmap.value?.objective ?? ''
  editingObjective.value = true
}
async function saveObjective() {
  await rm.setObjective(objectiveDraft.value).catch(() => {})
  editingObjective.value = false
}

// Adding a phase
const newPhase = ref('')
async function addPhase() {
  const title = newPhase.value.trim()
  if (!title)
    return
  const next = await rm.addPhase(title).catch(() => null)
  if (next) {
    newPhase.value = ''
    selectedId.value = next.phases[next.phases.length - 1]?.id ?? selectedId.value
  }
}

const startedAnalysis = ref<number | null>(null)
async function analyze() {
  startedAnalysis.value = await rm.analyze().catch(() => null)
}

function ignore() {}
function onUpdatePhase(changes: Parameters<typeof rm.updatePhase>[1]) {
  if (selected.value)
    rm.updatePhase(selected.value.id, changes).catch(ignore)
}
function onDeletePhase() {
  if (selected.value)
    rm.deletePhase(selected.value.id).catch(ignore)
}
function onMovePhase(direction: 'up' | 'down') {
  if (selected.value)
    rm.movePhase(selected.value.id, direction).catch(ignore)
}
function onSetCurrent(on: boolean) {
  if (selected.value)
    rm.setCurrent(on ? selected.value.id : null).catch(ignore)
}
function onAddItem(title: string, status: RoadmapStatus) {
  if (selected.value)
    rm.addItem(selected.value.id, title, status).catch(ignore)
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4" data-testid="project-intelligence">
    <!-- What is this project, and where is it now? -->
    <section class="cc-hero relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-line px-5 py-4" aria-labelledby="project-intelligence-title">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-md border-none bg-transparent px-1 text-ui-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
          data-testid="project-intelligence-back"
          @click="emit('back')"
        >
          ← Projects
        </button>
        <span class="text-label uppercase tracking-wider text-fg-faint">Project Intelligence</span>
      </div>
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="project-intelligence-title" class="m-0 text-[24px] font-semibold leading-tight tracking-tight text-fg">
          {{ project.name }}
        </h2>
        <span v-if="roadmap && roadmap.phases.length" class="font-mono text-ui-sm tabular-nums text-fg-mute" data-testid="project-overall">{{ overallLabel(roadmap) }}</span>
        <span v-if="roadmap?.summary.blocked" class="text-ui-sm text-warning-text" data-testid="project-blocked">⚠ {{ roadmap.summary.blocked }} blocked</span>
        <span v-if="roadmap?.pendingProposals" class="text-ui-sm text-accent">{{ roadmap.pendingProposals }} proposal{{ roadmap.pendingProposals === 1 ? '' : 's' }} to review</span>
      </div>

      <div v-if="!editingObjective" class="flex min-w-0 items-start gap-2">
        <p class="m-0 max-w-[70ch] text-body text-fg-soft" data-testid="project-objective">
          {{ roadmap?.objective || project.description || 'No objective yet.' }}
        </p>
        <button type="button" class="rm-icon-btn shrink-0" aria-label="Edit objective" data-testid="project-objective-edit" @click="editObjective">
          ✎
        </button>
      </div>
      <form v-else class="flex min-w-0 flex-col gap-2" @submit.prevent="saveObjective">
        <AppInput v-model="objectiveDraft" type="textarea" :rows="2" aria-label="Project objective" data-testid="project-objective-input" />
        <div class="flex gap-2">
          <AppButton variant="primary" size="sm" :disabled="busy" @click="saveObjective">
            Save objective
          </AppButton>
          <AppButton variant="outline" size="sm" @click="editingObjective = false">
            Cancel
          </AppButton>
        </div>
      </form>

      <!-- You are here -->
      <div v-if="roadmap && roadmap.phases.length" class="grid min-w-0 gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-position">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-label uppercase tracking-wider text-fg-faint">You are here</span>
          <span v-if="current" class="truncate text-body font-semibold text-live-text" data-testid="project-current-phase">◉ {{ current.title }}</span>
          <span v-else class="text-ui text-fg-mute" data-testid="project-no-current">No current phase set</span>
          <span v-if="current" class="text-ui-sm text-fg-mute">{{ STATUS_LABELS[current.status] }}<template v-if="progressLabel(current.progress)"> · {{ progressLabel(current.progress) }}</template></span>
        </div>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-label uppercase tracking-wider text-fg-faint">Next</span>
          <span v-if="next" class="truncate text-ui text-fg">{{ STATUS_GLYPHS[next.status] }} {{ next.title }}</span>
          <span v-else class="text-ui text-fg-mute">Nothing after the current phase</span>
        </div>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-label uppercase tracking-wider text-fg-faint">Agents here</span>
          <span class="text-ui" :class="working ? 'text-live-text' : 'text-fg-mute'">
            {{ projectAgents.length === 0 ? 'None running' : `${projectAgents.filter(a => a.working).length} working · ${projectAgents.length} running` }}
          </span>
        </div>
      </div>
    </section>

    <p v-if="error" class="m-0 rounded-control bg-danger-soft px-3 py-2 text-ui-sm text-danger-text" role="alert" data-testid="roadmap-error">
      {{ error }}
    </p>
    <p v-if="loading && !roadmap" class="m-0 text-ui text-fg-mute">
      Loading roadmap…
    </p>

    <div v-if="roadmap" class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <section class="cc-card flex min-w-0 flex-col gap-3 rounded-xl border border-line p-4" aria-labelledby="roadmap-title">
        <div class="flex flex-wrap items-baseline gap-2">
          <h3 id="roadmap-title" class="m-0 text-body font-semibold text-fg">
            Roadmap
          </h3>
          <span class="text-ui-sm text-fg-mute">Select a phase for detail</span>
        </div>

        <p v-if="roadmap.phases.length === 0" class="m-0 text-ui text-fg-mute" data-testid="roadmap-empty">
          No roadmap yet. Add the first phase, or analyze the project with AI and review its proposal.
        </p>
        <RoadmapMap
          v-else
          :roadmap="roadmap"
          :selected-id="selectedId"
          :working="working"
          :needs-you="needsYou"
          @select="selectedId = $event"
        />

        <form class="flex items-center gap-2 border-t border-line pt-3" @submit.prevent="addPhase">
          <AppInput v-model="newPhase" placeholder="Add a phase" aria-label="New phase name" class="flex-1" data-testid="roadmap-new-phase" />
          <AppButton variant="outline" class="shrink-0 whitespace-nowrap" :disabled="busy || !newPhase.trim()" data-testid="roadmap-add-phase" @click="addPhase">
            Add phase
          </AppButton>
        </form>
      </section>

      <div class="flex min-w-0 flex-col gap-4">
        <RoadmapPhaseDetail
          v-if="selected"
          :roadmap="roadmap"
          :phase="selected"
          :agents="projectAgents"
          :workspaces="workspaces"
          :busy="busy"
          @update-phase="onUpdatePhase"
          @delete-phase="onDeletePhase"
          @move-phase="onMovePhase"
          @set-current="onSetCurrent"
          @add-item="onAddItem"
          @update-item="(id, changes) => rm.updateItem(id, changes).catch(ignore)"
          @delete-item="id => rm.deleteItem(id).catch(ignore)"
          @move-item="(id, dir) => rm.moveItem(id, dir).catch(ignore)"
        />
        <RoadmapProposals
          :proposals="proposals"
          :agents="projectAgents"
          :busy="busy"
          :has-roadmap="roadmap.phases.length > 0"
          @analyze="analyze"
          @import="pid => rm.importProposal(pid).catch(ignore)"
          @accept="(id, mode) => rm.acceptProposal(id, mode).catch(ignore)"
          @reject="id => rm.rejectProposal(id).catch(ignore)"
        />
        <p v-if="startedAnalysis" class="m-0 text-ui-sm text-fg-mute" role="status" data-testid="roadmap-analysis-started">
          Project Intelligence agent started. When it finishes, import its proposal above — it may first ask you to trust the folder in Needs you.
        </p>
      </div>
    </div>
  </div>
</template>
