<script setup lang="ts">
import type { Roadmap, RoadmapPhase } from './roadmapModel'
import { computed } from 'vue'
import { phasePlace, progressLabel, progressPercent, PROVENANCE_HELP, PROVENANCE_LABELS, STATUS_GLYPHS, STATUS_LABELS } from './roadmapModel'

/*
 * The mission map (Phase 4B): the project's phases in order on one rail, with
 * the current phase unmistakable.
 *
 *   past      compact, with its status (a static ✓ for completed)
 *   current   larger: "You are here", its progress, a slow pulse on its node
 *   future    quiet
 *
 * Motion carries information only: the current node pulses slowly; a light
 * travels down the rail toward it only while an agent is working in this
 * project's folders; the node turns amber with a halo while an agent here
 * needs a person. Blocked phases are a static amber warning. Reduced motion
 * leaves all of it still. Status is always a glyph and a word, never colour.
 */
const props = defineProps<{
  roadmap: Roadmap
  selectedId: string | null
  /** An agent is working in this project's folders. */
  working?: boolean
  /** An agent in this project's folders needs a person. */
  needsYou?: boolean
}>()
const emit = defineEmits<{ select: [phaseId: string] }>()

const rows = computed(() => props.roadmap.phases.map((phase, index) => ({
  phase,
  index,
  place: phasePlace(props.roadmap, phase),
  progress: progressLabel(phase.progress),
  percent: progressPercent(phase.progress),
})))

const currentIndex = computed(() => props.roadmap.phases.findIndex(p => p.current))

function nodeClass(phase: RoadmapPhase, place: string): string {
  if (phase.status === 'blocked')
    return 'rm-node rm-node-blocked'
  if (phase.status === 'completed')
    return 'rm-node rm-node-completed'
  if (place === 'current')
    return 'rm-node rm-node-current'
  if (phase.status === 'active')
    return 'rm-node rm-node-active'
  return 'rm-node rm-node-future'
}
</script>

<template>
  <ol class="rm-map m-0 flex list-none flex-col p-0" data-testid="roadmap-map" aria-label="Roadmap phases">
    <li
      v-for="row in rows"
      :key="row.phase.id"
      class="rm-row relative flex gap-3 pl-1"
      :class="[`rm-place-${row.place}`, row.index < rows.length - 1 ? 'pb-2' : '']"
      :data-testid="`roadmap-phase-${row.phase.id}`"
      :data-place="row.place"
      :data-status="row.phase.status"
    >
      <!-- Rail to the next phase; it carries flow only toward the current phase, while an agent works here. -->
      <span
        v-if="row.index < rows.length - 1"
        class="rm-rail absolute left-[1.05rem] top-7 bottom-0 w-px"
        :class="[
          row.place === 'past' || row.phase.current ? 'rm-rail-done' : 'rm-rail-future',
          working && currentIndex > 0 && row.index === currentIndex - 1 ? 'cc-rail-flow motion-rail' : '',
        ]"
        :data-flowing="working && currentIndex > 0 && row.index === currentIndex - 1 ? 'true' : undefined"
        aria-hidden="true"
      />

      <span class="relative mt-1 flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
        <span
          v-if="row.phase.current && needsYou"
          class="absolute inset-0 rounded-full motion-waiting"
          data-testid="roadmap-needs-you"
        />
        <span
          v-else-if="row.phase.current"
          class="rm-pulse absolute inset-0 rounded-full"
          data-testid="roadmap-current-pulse"
        />
        <span :class="nodeClass(row.phase, row.place)" class="relative flex size-6 items-center justify-center rounded-full border text-[12px] font-semibold">
          {{ STATUS_GLYPHS[row.phase.status] }}
        </span>
      </span>

      <button
        type="button"
        class="rm-phase group flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-lg border px-3 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        :class="[
          row.phase.current ? 'rm-phase-current py-3' : 'py-2',
          selectedId === row.phase.id ? 'rm-phase-selected' : '',
        ]"
        :aria-current="row.phase.current ? 'step' : undefined"
        :aria-pressed="selectedId === row.phase.id"
        :data-testid="`roadmap-phase-open-${row.phase.id}`"
        @click="emit('select', row.phase.id)"
      >
        <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            v-if="row.phase.current"
            class="rounded-md border border-state-live/50 bg-state-live/10 px-1.5 py-0.5 font-mono text-label font-semibold uppercase tracking-wider text-live-text"
            data-testid="roadmap-you-are-here"
          >You are here</span>
          <span class="min-w-0 truncate font-semibold text-fg" :class="row.phase.current ? 'text-body' : 'text-ui'">
            {{ row.phase.title }}
          </span>
          <span
            class="text-ui-sm"
            :class="row.phase.status === 'blocked' ? 'text-warning-text' : row.phase.status === 'completed' ? 'text-success-text' : row.phase.status === 'active' ? 'text-live-text' : 'text-fg-mute'"
            data-testid="roadmap-phase-status"
          >{{ STATUS_LABELS[row.phase.status] }}</span>
          <span
            class="ml-auto shrink-0 rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint"
            :title="PROVENANCE_HELP[row.phase.provenance]"
            data-testid="roadmap-phase-provenance"
          >{{ PROVENANCE_LABELS[row.phase.provenance] }}</span>
        </span>

        <span v-if="row.phase.current && row.phase.description" class="line-clamp-2 text-ui-sm text-fg-soft">
          {{ row.phase.description }}
        </span>
        <span v-if="row.phase.status === 'blocked' && row.phase.blockedReason" class="truncate text-ui-sm text-warning-text">
          ⚠ {{ row.phase.blockedReason }}
        </span>

        <span v-if="row.progress" class="flex items-center gap-2 text-ui-sm text-fg-mute" data-testid="roadmap-phase-progress">
          <span
            class="relative h-1 min-w-12 flex-1 overflow-hidden rounded-full bg-line"
            :class="row.phase.current ? 'max-w-64' : 'max-w-32'"
            role="img"
            :aria-label="row.progress"
          >
            <span class="absolute inset-y-0 left-0 rounded-full" :class="row.phase.status === 'completed' ? 'bg-state-success' : 'bg-accent'" :style="{ width: `${row.percent}%` }" />
          </span>
          <span class="font-mono tabular-nums">{{ row.progress }}</span>
        </span>
      </button>
    </li>
  </ol>
</template>
