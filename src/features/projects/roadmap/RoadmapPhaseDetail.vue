<script setup lang="ts">
import type { Roadmap, RoadmapItem, RoadmapPhase, RoadmapStatus } from './roadmapModel'
import type { ItemChanges, PhaseChanges } from './useRoadmap'
import type { Agent } from '@/types'
import { computed, ref, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppFieldLabel from '@/components/ui/AppFieldLabel.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { agentTitle } from '@/utils/agentLabels'
import { STAGE_LABELS } from '@/utils/stageLabels'
import { progressLabel, PROVENANCE_HELP, PROVENANCE_LABELS, ROADMAP_STATUSES, STATUS_GLYPHS, STATUS_LABELS } from './roadmapModel'

/*
 * One phase in detail (Phase 4B), with progressive disclosure: what it is for,
 * what is done, what is in progress, what remains, what blocks it, who is
 * working on it and where, the decisions recorded, and where the information
 * came from. Editing is inline, never JSON.
 *
 * "Next remaining item" is the first item still to do, as the roadmap orders
 * it — the roadmap's own statement, not a recommendation invented here.
 */
const props = defineProps<{
  roadmap: Roadmap
  phase: RoadmapPhase
  /** Agents in this project's folders (path containment). */
  agents: Agent[]
  /** Folder names of the project's workspaces. */
  workspaces: string[]
  busy: boolean
}>()
const emit = defineEmits<{
  updatePhase: [changes: PhaseChanges]
  deletePhase: []
  movePhase: [direction: 'up' | 'down']
  setCurrent: [current: boolean]
  addItem: [title: string, status: RoadmapStatus]
  updateItem: [itemId: string, changes: ItemChanges]
  deleteItem: [itemId: string]
  moveItem: [itemId: string, direction: 'up' | 'down']
}>()

const statusOptions = ROADMAP_STATUSES.map(s => ({ value: s, label: `${STATUS_GLYPHS[s]} ${STATUS_LABELS[s]}` }))

const completed = computed(() => props.phase.items.filter(i => i.status === 'completed'))
const inProgress = computed(() => props.phase.items.filter(i => i.status === 'active'))
const remaining = computed(() => props.phase.items.filter(i => i.status === 'planned' || i.status === 'ready'))
const blockedItems = computed(() => props.phase.items.filter(i => i.status === 'blocked'))
const dependsOn = computed(() => props.phase.dependsOn
  .map(id => props.roadmap.phases.find(p => p.id === id))
  .filter((p): p is RoadmapPhase => !!p))
const index = computed(() => props.roadmap.phases.findIndex(p => p.id === props.phase.id))
const progress = computed(() => progressLabel(props.phase.progress))
const nextItem = computed(() => remaining.value[0] ?? null)

const editing = ref(false)
const confirmDelete = ref(false)
const draft = ref({ title: '', description: '', status: 'planned' as RoadmapStatus, blockedReason: '', decisions: '', dependsOn: [] as string[] })
const newItem = ref('')

function resetDraft() {
  draft.value = {
    title: props.phase.title,
    description: props.phase.description,
    status: props.phase.status,
    blockedReason: props.phase.blockedReason ?? '',
    decisions: props.phase.decisions ?? '',
    dependsOn: [...props.phase.dependsOn],
  }
}
watch(() => props.phase.id, () => {
  editing.value = false
  confirmDelete.value = false
  newItem.value = ''
  resetDraft()
}, { immediate: true })

function startEdit() {
  resetDraft()
  editing.value = true
}

function save() {
  emit('updatePhase', { ...draft.value })
  editing.value = false
}

function toggleDependency(id: string, on: boolean) {
  draft.value.dependsOn = on ? [...new Set([...draft.value.dependsOn, id])] : draft.value.dependsOn.filter(d => d !== id)
}

function addItem() {
  const title = newItem.value.trim()
  if (!title)
    return
  emit('addItem', title, 'planned')
  newItem.value = ''
}

function cycleItem(item: RoadmapItem, status: RoadmapStatus) {
  emit('updateItem', item.id, { status })
}

const SECTION = 'flex flex-col gap-1.5'
const HEADING = 'm-0 text-label font-semibold uppercase tracking-wider text-fg-mute'
</script>

<template>
  <section
    class="cc-card flex min-w-0 flex-col gap-4 rounded-xl border border-line p-4"
    :aria-labelledby="`roadmap-detail-title-${phase.id}`"
    data-testid="roadmap-detail"
  >
    <header class="flex min-w-0 flex-col gap-1">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="font-mono text-ui-sm text-fg-mute">Phase {{ index + 1 }}</span>
        <span v-if="phase.current" class="rounded-md border border-state-live/50 bg-state-live/10 px-1.5 py-0.5 font-mono text-label font-semibold uppercase tracking-wider text-live-text">You are here</span>
        <span class="text-ui-sm text-fg-soft" data-testid="roadmap-detail-status">{{ STATUS_GLYPHS[phase.status] }} {{ STATUS_LABELS[phase.status] }}</span>
        <span class="ml-auto rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint" :title="PROVENANCE_HELP[phase.provenance]">
          {{ PROVENANCE_LABELS[phase.provenance] }}
        </span>
      </div>
      <h3 :id="`roadmap-detail-title-${phase.id}`" class="m-0 text-title font-semibold text-fg">
        {{ phase.title }}
      </h3>
      <p v-if="progress" class="m-0 font-mono text-ui-sm tabular-nums text-fg-mute">
        {{ progress }}
      </p>
    </header>

    <!-- Reading -->
    <template v-if="!editing">
      <div :class="SECTION">
        <h4 :class="HEADING">
          Objective
        </h4>
        <p class="m-0 whitespace-pre-line text-ui text-fg-soft" data-testid="roadmap-detail-objective">
          {{ phase.description || 'No description yet.' }}
        </p>
      </div>

      <div v-if="phase.status === 'blocked' || blockedItems.length" :class="SECTION" data-testid="roadmap-detail-blockers">
        <h4 :class="HEADING">
          Blockers
        </h4>
        <p v-if="phase.blockedReason" class="m-0 text-ui text-warning-text">
          ⚠ {{ phase.blockedReason }}
        </p>
        <p v-for="item in blockedItems" :key="item.id" class="m-0 text-ui text-warning-text">
          ⚠ {{ item.title }}<span v-if="item.blockedReason" class="text-fg-mute"> — {{ item.blockedReason }}</span>
        </p>
      </div>

      <div :class="SECTION" data-testid="roadmap-detail-items">
        <h4 :class="HEADING">
          Work
        </h4>
        <p v-if="phase.items.length === 0" class="m-0 text-ui-sm text-fg-mute">
          No items yet. Add the concrete pieces of work to track progress.
        </p>
        <ul v-else class="m-0 flex list-none flex-col gap-1 p-0">
          <li v-for="item in phase.items" :key="item.id" class="flex min-w-0 items-center gap-2 text-ui" :data-testid="`roadmap-item-${item.id}`">
            <span class="w-4 shrink-0 text-center" :class="item.status === 'completed' ? 'text-success-text' : item.status === 'blocked' ? 'text-warning-text' : item.status === 'active' ? 'text-live-text' : 'text-fg-faint'" aria-hidden="true">{{ STATUS_GLYPHS[item.status] }}</span>
            <span class="min-w-0 flex-1 truncate" :class="item.status === 'completed' || item.status === 'skipped' ? 'text-fg-mute' : 'text-fg'">{{ item.title }}</span>
            <span class="sr-only">{{ STATUS_LABELS[item.status] }}</span>
            <span v-if="item.task" class="shrink-0 font-mono text-label text-fg-mute" :title="`Linked task: ${item.task.title}`">task · {{ STAGE_LABELS[item.task.stage as keyof typeof STAGE_LABELS] ?? item.task.stage }}</span>
            <span class="shrink-0 rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint" :title="PROVENANCE_HELP[item.provenance]">{{ PROVENANCE_LABELS[item.provenance] }}</span>
          </li>
        </ul>
        <p v-if="phase.items.length" class="m-0 text-ui-sm text-fg-mute">
          {{ completed.length }} completed · {{ inProgress.length }} in progress · {{ remaining.length }} remaining
        </p>
      </div>

      <div v-if="nextItem || phase.current" :class="SECTION" data-testid="roadmap-detail-next">
        <h4 :class="HEADING">
          Next remaining item
        </h4>
        <p class="m-0 text-ui" :class="nextItem ? 'text-fg' : 'text-fg-mute'">
          {{ nextItem ? `○ ${nextItem.title}` : 'Nothing remaining is listed for this phase.' }}
        </p>
      </div>

      <div v-if="phase.current" :class="SECTION" data-testid="roadmap-detail-agents">
        <h4 :class="HEADING">
          Agents in this project
        </h4>
        <p v-if="agents.length === 0" class="m-0 text-ui-sm text-fg-mute">
          No agent is running in this project's folders.
        </p>
        <ul v-else class="m-0 flex list-none flex-col gap-1 p-0">
          <li v-for="a in agents" :key="`${a.sessionId}-${a.pid}`" class="flex min-w-0 items-center gap-2 text-ui">
            <span class="size-1.5 shrink-0 rounded-full" :class="a.working ? 'bg-state-working' : 'bg-state-idle'" aria-hidden="true" />
            <span class="min-w-0 truncate text-fg">{{ agentTitle(a) }}</span>
            <span class="text-ui-sm text-fg-mute">{{ a.working ? 'working' : a.status }}</span>
          </li>
        </ul>
        <p class="m-0 text-ui-sm text-fg-faint">
          Agents are matched to the project by working folder, not to a specific phase.
        </p>
      </div>

      <div v-if="workspaces.length" :class="SECTION">
        <h4 :class="HEADING">
          Workspaces
        </h4>
        <p class="m-0 flex flex-wrap gap-x-3 font-mono text-ui-sm text-fg-soft">
          <span v-for="w in workspaces" :key="w">{{ w }}</span>
        </p>
      </div>

      <div v-if="dependsOn.length" :class="SECTION">
        <h4 :class="HEADING">
          Depends on
        </h4>
        <p v-for="d in dependsOn" :key="d.id" class="m-0 text-ui text-fg-soft">
          {{ STATUS_GLYPHS[d.status] }} {{ d.title }} <span class="text-fg-mute">— {{ STATUS_LABELS[d.status] }}</span>
        </p>
      </div>

      <div v-if="phase.decisions" :class="SECTION">
        <h4 :class="HEADING">
          Important decisions
        </h4>
        <p class="m-0 whitespace-pre-line text-ui text-fg-soft">
          {{ phase.decisions }}
        </p>
      </div>

      <div :class="SECTION">
        <h4 :class="HEADING">
          Source
        </h4>
        <p class="m-0 text-ui-sm text-fg-mute" data-testid="roadmap-detail-source">
          {{ PROVENANCE_LABELS[phase.provenance] }} — {{ PROVENANCE_HELP[phase.provenance] }}.
          Updated {{ new Date(phase.updatedAt).toLocaleString() }}.
        </p>
      </div>

      <footer class="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <AppButton variant="primary" :disabled="busy" data-testid="roadmap-edit-phase" @click="startEdit">
          Edit phase
        </AppButton>
        <AppButton v-if="!phase.current" variant="outline" :disabled="busy" data-testid="roadmap-set-current" @click="emit('setCurrent', true)">
          Mark as current
        </AppButton>
        <AppButton v-else variant="outline" :disabled="busy" data-testid="roadmap-clear-current" @click="emit('setCurrent', false)">
          Clear current
        </AppButton>
        <AppButton variant="outline" :disabled="busy || index === 0" aria-label="Move phase up" data-testid="roadmap-move-up" @click="emit('movePhase', 'up')">
          ↑
        </AppButton>
        <AppButton variant="outline" :disabled="busy || index === roadmap.phases.length - 1" aria-label="Move phase down" data-testid="roadmap-move-down" @click="emit('movePhase', 'down')">
          ↓
        </AppButton>
      </footer>
    </template>

    <!-- Editing -->
    <form v-else class="flex flex-col gap-3" data-testid="roadmap-phase-form" @submit.prevent="save">
      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="roadmap-phase-title">
          Name
        </AppFieldLabel>
        <AppInput id="roadmap-phase-title" v-model="draft.title" data-testid="roadmap-phase-title" />
      </div>
      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="roadmap-phase-status">
          Status
        </AppFieldLabel>
        <AppSelect id="roadmap-phase-status" v-model="draft.status" :options="statusOptions" data-testid="roadmap-phase-status-select" />
      </div>
      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="roadmap-phase-description">
          Objective
        </AppFieldLabel>
        <AppInput id="roadmap-phase-description" v-model="draft.description" type="textarea" :rows="3" data-testid="roadmap-phase-description" />
      </div>
      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="roadmap-phase-blocker">
          Blocker
        </AppFieldLabel>
        <AppInput id="roadmap-phase-blocker" v-model="draft.blockedReason" placeholder="What is in the way, if anything" data-testid="roadmap-phase-blocker" />
      </div>
      <div class="flex flex-col gap-1.5">
        <AppFieldLabel for="roadmap-phase-decisions">
          Important decisions
        </AppFieldLabel>
        <AppInput id="roadmap-phase-decisions" v-model="draft.decisions" type="textarea" :rows="2" data-testid="roadmap-phase-decisions" />
      </div>
      <fieldset v-if="roadmap.phases.length > 1" class="m-0 flex flex-col gap-1 border-0 p-0">
        <legend class="mb-1 text-label font-semibold uppercase tracking-wider text-fg-mute">
          Depends on
        </legend>
        <label v-for="p in roadmap.phases.filter(p => p.id !== phase.id)" :key="p.id" class="flex items-center gap-2 text-ui text-fg-soft">
          <input type="checkbox" :checked="draft.dependsOn.includes(p.id)" @change="toggleDependency(p.id, ($event.target as HTMLInputElement).checked)">
          {{ p.title }}
        </label>
      </fieldset>

      <div class="flex flex-col gap-1.5" data-testid="roadmap-items-editor">
        <span class="text-label font-semibold uppercase tracking-wider text-fg-mute">Items</span>
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li v-for="(item, i) in phase.items" :key="item.id" class="flex min-w-0 items-center gap-1.5">
            <AppSelect
              :model-value="item.status"
              :options="statusOptions"
              size="compact"
              :aria-label="`Status of ${item.title}`"
              class="w-32 shrink-0"
              :disabled="!!item.task"
              @update:model-value="cycleItem(item, $event)"
            />
            <span class="min-w-0 flex-1 truncate text-ui text-fg">{{ item.title }}</span>
            <button type="button" class="rm-icon-btn" :disabled="busy || i === 0" :aria-label="`Move ${item.title} up`" @click="emit('moveItem', item.id, 'up')">
              ↑
            </button>
            <button type="button" class="rm-icon-btn" :disabled="busy || i === phase.items.length - 1" :aria-label="`Move ${item.title} down`" @click="emit('moveItem', item.id, 'down')">
              ↓
            </button>
            <button type="button" class="rm-icon-btn hover:text-danger-text" :disabled="busy" :aria-label="`Remove ${item.title}`" @click="emit('deleteItem', item.id)">
              ✕
            </button>
          </li>
        </ul>
        <div class="flex items-center gap-2">
          <AppInput v-model="newItem" placeholder="Add an item" aria-label="New item" class="flex-1" data-testid="roadmap-new-item" @keydown.enter.prevent="addItem" />
          <AppButton type="button" variant="outline" class="shrink-0 whitespace-nowrap" :disabled="busy || !newItem.trim()" data-testid="roadmap-add-item" @click="addItem">
            Add
          </AppButton>
        </div>
      </div>

      <footer class="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <AppButton variant="primary" :disabled="busy || !draft.title.trim()" data-testid="roadmap-save-phase" @click="save">
          Save
        </AppButton>
        <AppButton variant="outline" :disabled="busy" @click="editing = false">
          Cancel
        </AppButton>
        <span class="ml-auto flex items-center gap-2">
          <template v-if="confirmDelete">
            <span class="text-ui-sm text-danger-text">Delete this phase and its items?</span>
            <AppButton variant="danger" :disabled="busy" data-testid="roadmap-confirm-delete" @click="emit('deletePhase')">Delete</AppButton>
            <AppButton variant="outline" :disabled="busy" @click="confirmDelete = false">Keep</AppButton>
          </template>
          <AppButton v-else variant="outline" :disabled="busy" data-testid="roadmap-delete-phase" @click="confirmDelete = true">Delete phase</AppButton>
        </span>
      </footer>
    </form>
  </section>
</template>
