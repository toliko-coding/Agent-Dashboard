<script setup lang="ts">
import type { OrchestrationDependencyEdge, OrchestrationTaskNode } from '../types'
import { computed } from 'vue'
import { STAGE_LABELS } from '@/utils/stageLabels'
import { edgePath, layoutGraph } from '../utils/graphLayout'

/*
 * The orchestration graph.
 *
 * Deterministic and hand-drawn as SVG rather than fed to a force layout: the
 * same tree must render identically on every poll, or the picture would shuffle
 * itself under the reader every 15 seconds.
 *
 * Two edge kinds, drawn differently on purpose:
 *   - solid  = delegation (parent → child), from parent_task_id
 *   - dashed = dependency, from a stored task_dependency row
 * They are different relationships and must never look alike.
 */
const props = defineProps<{
  tasks: OrchestrationTaskNode[]
  dependencies: OrchestrationDependencyEdge[]
  selectedId?: string | null
}>()

const emit = defineEmits<{ (e: 'select', taskId: string): void }>()

const layout = computed(() => layoutGraph(props.tasks, props.dependencies))

const delegationEdges = computed(() => layout.value.edges.filter(e => e.kind === 'delegation'))
const dependencyEdges = computed(() => layout.value.edges.filter(e => e.kind === 'dependency'))

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage
}

/*
 * Stage tone, from the stored stage only. There is no synthetic health verdict
 * here because the pipeline has no such concept.
 */
function stageTone(stage: string): string {
  if (stage === 'done')
    return 'fill-success-text'
  if (stage === 'cancelled')
    return 'fill-fg-mute'
  if (stage === 'on_hold')
    return 'fill-warning-text'
  return 'fill-fg-mute'
}

function truncate(text: string, max = 22): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
</script>

<template>
  <div class="overflow-x-auto">
    <svg
      v-if="layout.nodes.length > 0"
      :width="layout.width"
      :height="layout.height"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      role="img"
      aria-label="Orchestration graph: solid lines are delegation, dashed lines are dependencies"
      class="max-w-none"
    >
      <defs>
        <marker
          id="orch-arrow-delegation" viewBox="0 0 8 8" refX="7" refY="4"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" class="fill-line-strong" />
        </marker>
        <marker
          id="orch-arrow-dependency" viewBox="0 0 8 8" refX="7" refY="4"
          markerWidth="6" markerHeight="6" orient="auto-start-reverse"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" class="fill-info-text" />
        </marker>
      </defs>

      <!-- Delegation: solid. -->
      <path
        v-for="edge in delegationEdges"
        :key="edge.id"
        :d="edgePath(edge)"
        fill="none"
        stroke-width="1.5"
        class="stroke-line-strong"
        marker-end="url(#orch-arrow-delegation)"
      />

      <!-- Dependency: dashed, and a different colour, so the two kinds are
           distinguishable without relying on stroke pattern alone. -->
      <path
        v-for="edge in dependencyEdges"
        :key="edge.id"
        :d="edgePath(edge)"
        fill="none"
        stroke-width="1.5"
        stroke-dasharray="4 3"
        class="stroke-info-text"
        marker-end="url(#orch-arrow-dependency)"
      >
        <title>Depends on completion of {{ stageLabel(edge.label ?? '') }}</title>
      </path>

      <g
        v-for="item in layout.nodes"
        :key="item.node.id"
        class="cursor-pointer"
        role="button"
        tabindex="0"
        :aria-label="`${item.node.title} — ${stageLabel(item.node.stage)}`"
        @click="emit('select', item.node.id)"
        @keydown.enter.prevent="emit('select', item.node.id)"
        @keydown.space.prevent="emit('select', item.node.id)"
      >
        <rect
          :x="item.x" :y="item.y" :width="item.width" :height="item.height"
          rx="6"
          class="fill-raised stroke-line"
          :class="{ 'stroke-accent stroke-2': item.node.id === props.selectedId }"
        />
        <text
          :x="item.x + 10" :y="item.y + 18"
          class="fill-fg text-[11px] font-medium"
        >
          {{ truncate(item.node.title) }}
        </text>
        <text
          :x="item.x + 10" :y="item.y + 33"
          class="text-[10px]"
          :class="stageTone(item.node.stage)"
        >
          {{ stageLabel(item.node.stage) }}
        </text>
        <!-- Provenance marker. Absent — not a placeholder agent — when a human
             created the task. -->
        <text
          v-if="item.node.delegatedByStageRunId"
          :x="item.x + item.width - 10" :y="item.y + 33"
          text-anchor="end"
          class="fill-info-text text-[10px]"
        >
          delegated
        </text>
        <title>{{ item.node.title }} ({{ item.node.slug }}) — {{ stageLabel(item.node.stage) }}</title>
      </g>
    </svg>

    <p v-else class="text-sm text-fg-mute">
      Nothing to draw.
    </p>

    <div class="mt-3 flex flex-wrap items-center gap-4 text-xs text-fg-mute">
      <span class="inline-flex items-center gap-2">
        <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke-width="1.5" class="stroke-line-strong" /></svg>
        Delegation (parent → child)
      </span>
      <span class="inline-flex items-center gap-2">
        <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke-width="1.5" stroke-dasharray="4 3" class="stroke-info-text" /></svg>
        Dependency (must finish first)
      </span>
    </div>
  </div>
</template>
