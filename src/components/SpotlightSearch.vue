<script setup lang="ts">
import type { Agent, PipelineStage, PipelineTask } from '../types'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { workspaceDisplay } from '../utils/agentGroup'
import { agentTitle } from '../utils/agentLabels'
import { STAGE_LABELS } from '../utils/stageLabels'
import { agentDisplayStatus, statusLabel } from '../utils/statusColors'
import AppModal from './ui/AppModal.vue'

const emit = defineEmits<{
  navigateTask: [task: PipelineTask]
  navigateAgent: [agent: Agent]
}>()

const open = ref(false)
const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const selectedIdx = ref(0)

// Focus management: store the element that triggered the dialog so we can restore focus on close
let previouslyFocusedElement: Element | null = null

interface SearchResults {
  tasks: PipelineTask[]
  agents: Agent[]
}

const results = ref<SearchResults>({ tasks: [], agents: [] })

/*
 * How a result reads. An agent is named the way every surface names it
 * (agentTitle), stated by its state word, and placed by repository and
 * workspace — never by its folder or path. A task keeps its title and its
 * stage, in words.
 */
function agentWhere(agent: Agent): string {
  const ws = agent.workspace
  if (!ws?.id)
    return 'Workspace unknown'
  const display = workspaceDisplay(ws)
  if (ws.kind === 'plain')
    return display.title
  return `${ws.repository?.name || 'Repository'} · ${display.title}`
}

function agentState(agent: Agent): string {
  return statusLabel(agentDisplayStatus({ status: agent.status, working: Boolean(agent.working) }))
}

function stageLabel(stage: PipelineStage): string {
  return STAGE_LABELS[stage] ?? stage
}
const loading = ref(false)
let debounceHandle: ReturnType<typeof setTimeout> | null = null
let abortController: AbortController | null = null

const flatResults = computed((): Array<{ type: 'task', item: PipelineTask } | { type: 'agent', item: Agent }> => {
  return [
    ...results.value.tasks.map(t => ({ type: 'task' as const, item: t })),
    ...results.value.agents.map(a => ({ type: 'agent' as const, item: a })),
  ]
})

// Clamp selectedIdx when results shrink to avoid out-of-bounds
watch(flatResults, (newResults) => {
  selectedIdx.value = Math.min(selectedIdx.value, Math.max(0, newResults.length - 1))
})

async function search(q: string) {
  abortController?.abort()
  abortController = new AbortController()

  if (!q.trim()) {
    results.value = { tasks: [], agents: [] }
    return
  }
  loading.value = true
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=all&limit=10`, {
      signal: abortController.signal,
    })
    if (!res.ok) {
      results.value = { tasks: [], agents: [] }
      return
    }
    results.value = await res.json() as SearchResults
    selectedIdx.value = 0
  }
  catch (e) {
    if (e instanceof Error && e.name === 'AbortError')
      return // ignore aborted requests
    results.value = { tasks: [], agents: [] }
  }
  finally {
    loading.value = false
  }
}

function activate(result: typeof flatResults.value[number]) {
  if (result.type === 'task')
    emit('navigateTask', result.item)
  else
    emit('navigateAgent', result.item)
  closeDialog()
}

function openDialog() {
  previouslyFocusedElement = document.activeElement
  open.value = true
  /*
   * AppModal moves focus to its panel on the tick after it opens, which used
   * to land after this and leave the field unfocused — typing straight after
   * ⌘K went nowhere. Focusing once the modal has settled keeps the field first.
   */
  void nextTick(() => setTimeout(() => inputRef.value?.focus(), 0))
}

// Lets the topbar's search affordance open the same dialog as ⌘K, so there is
// one search implementation rather than a second field that filters nothing.
defineExpose({ open: openDialog })

function closeDialog() {
  open.value = false
  query.value = ''
  results.value = { tasks: [], agents: [] }
  // Restore focus to the element that was focused before the dialog opened
  if (previouslyFocusedElement instanceof HTMLElement) {
    previouslyFocusedElement.focus()
  }
}

watch(query, (q) => {
  if (debounceHandle)
    clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    search(q).catch(() => {
      results.value = { tasks: [], agents: [] }
    })
  }, 200)
})

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    if (open.value)
      closeDialog()
    else
      openDialog()
    return
  }
  if (!open.value)
    return
  if (e.key === 'Escape') {
    closeDialog()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIdx.value = Math.min(selectedIdx.value + 1, flatResults.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const selected = flatResults.value[selectedIdx.value]
    if (!selected)
      return
    activate(selected)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <AppModal :open="open" :z-index="2000" size="auto" labelled-by="spotlight-search-label" @close="closeDialog">
    <div
      class="bg-card rounded-panel border border-line shadow-2xl w-full max-w-lg overflow-hidden"
    >
      <span id="spotlight-search-label" class="sr-only">Quick search</span>
      <!-- Live region for result count -->
      <div aria-live="polite" class="sr-only">
        {{ flatResults.length }} results
      </div>
      <div class="flex items-center gap-2 px-4 py-3 border-b border-line focus-within:ring-[3px] focus-within:ring-accent">
        <span class="text-fg-faint text-ui-sm font-mono" aria-hidden="true">⌘K</span>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          role="combobox"
          :aria-expanded="flatResults.length > 0"
          aria-controls="spotlight-listbox"
          aria-autocomplete="list"
          :aria-activedescendant="selectedIdx >= 0 && flatResults.length > 0 ? `spotlight-opt-${selectedIdx}` : undefined"
          placeholder="Search tasks and agents…"
          class="flex-1 bg-transparent text-ui text-fg focus-visible:outline-none placeholder:text-fg-faint"
        >
        <span v-if="loading" class="text-ui-sm text-fg-mute">Searching…</span>
      </div>
      <div
        id="spotlight-listbox"
        role="listbox"
        :aria-busy="loading"
        class="max-h-80 overflow-y-auto"
      >
        <template v-if="flatResults.length === 0 && query">
          <p class="px-4 py-3 text-ui text-fg-mute" data-testid="spotlight-empty">
            No tasks or agents match "{{ query }}".
          </p>
        </template>
        <template v-else>
          <!-- Tasks section -->
          <template v-if="results.tasks.length > 0">
            <div class="px-3 pt-2 pb-1 text-label font-semibold uppercase tracking-wide text-fg-mute">
              Tasks
            </div>
            <div
              v-for="(task, idx) in results.tasks"
              :id="`spotlight-opt-${idx}`"
              :key="`task-${task.id}`"
              role="option"
              tabindex="-1"
              :aria-selected="selectedIdx === idx"
              class="w-full text-left px-4 py-2 text-ui flex items-center gap-3 transition-colors cursor-pointer"
              data-testid="spotlight-task"
              :class="selectedIdx === idx
                ? 'bg-accent-soft text-accent'
                : 'text-fg-soft hover:bg-raised'"
              @click="activate({ type: 'task', item: task })"
              @mouseenter="selectedIdx = idx"
            >
              <span class="text-label uppercase tracking-wide text-fg-mute w-12 flex-shrink-0">Task</span>
              <span class="truncate">{{ task.title }}</span>
              <span class="ml-auto shrink-0 text-ui-sm text-fg-mute" data-testid="spotlight-task-stage">{{ stageLabel(task.currentStage) }}</span>
            </div>
          </template>

          <!-- Agents section -->
          <template v-if="results.agents.length > 0">
            <div
              class="px-3 pt-2 pb-1 text-label font-semibold uppercase tracking-wide text-fg-mute"
              :class="{ 'border-t border-line mt-1': results.tasks.length > 0 }"
            >
              Agents
            </div>
            <div
              v-for="(agent, idx) in results.agents"
              :id="`spotlight-opt-${results.tasks.length + idx}`"
              :key="`agent-${agent.sessionId}`"
              role="option"
              tabindex="-1"
              :aria-selected="selectedIdx === (results.tasks.length + idx)"
              class="w-full text-left px-4 py-2 text-ui flex items-center gap-3 transition-colors cursor-pointer"
              data-testid="spotlight-agent"
              :class="selectedIdx === (results.tasks.length + idx)
                ? 'bg-accent-soft text-accent'
                : 'text-fg-soft hover:bg-raised'"
              @click="activate({ type: 'agent', item: agent })"
              @mouseenter="selectedIdx = results.tasks.length + idx"
            >
              <span class="text-label uppercase tracking-wide text-fg-mute w-12 flex-shrink-0">Agent</span>
              <span class="flex min-w-0 flex-col">
                <span class="truncate" data-testid="spotlight-agent-name">{{ agentTitle(agent) }}</span>
                <span class="truncate text-ui-sm text-fg-mute" data-testid="spotlight-agent-where">{{ agentWhere(agent) }}</span>
              </span>
              <span class="ml-auto shrink-0 text-ui-sm text-fg-mute" data-testid="spotlight-agent-state">{{ agentState(agent) }}</span>
            </div>
          </template>
        </template>
      </div>
      <div class="px-4 py-2 border-t border-line flex gap-3 text-label text-fg-mute">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>Esc close</span>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
</style>
