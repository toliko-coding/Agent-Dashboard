<script setup lang="ts">
import type { PipelineTask, StageRun } from '@/types'
import type { TimelineStepState } from '@/utils/runState'
import { computed } from 'vue'
import { formatDateTime } from '@/utils/format'
import { FAILURE_CATEGORY_LABELS, failureCategoryOf, failureReasonOf, RUN_ROLE_LABELS, RUN_STATE_LABELS, runStateOf, runTimeline } from '@/utils/runState'

/*
 * A task's run as a timeline (Phase 4D, ADR-0014): Queued → Preparing →
 * Developer → Reviewer → Finalization → Result, from the task and its stage
 * runs only. A step is done only when its stage run is done; the result
 * succeeds only when the task is done. The running step's marker moves only
 * while its run is running; reduced motion keeps it still.
 */
const props = defineProps<{
  task: Pick<PipelineTask, 'currentStage' | 'latestStageRunStatus' | 'needsUser' | 'blockedByPendingPermissions'>
  stageRuns: StageRun[]
}>()

const state = computed(() => runStateOf(props.task))
const steps = computed(() => runTimeline(props.task, props.stageRuns))

// Why the run stopped (Phase 4.1): the category the server persisted where the
// failure was known, and its human reason beside it. Never guessed from text.
const problem = computed(() => {
  const step = [...steps.value].reverse().find(s => s.run && (s.state === 'failed' || (s.state === 'waiting' && failureCategoryOf(s.run))))
  if (!step?.run)
    return null
  return { step, category: failureCategoryOf(step.run), reason: failureReasonOf(step.run) }
})

const GLYPH: Record<TimelineStepState, string> = {
  done: '✓',
  current: '◉',
  waiting: '⚠',
  failed: '✕',
  pending: '○',
  skipped: '⤼',
}
const WORD: Record<TimelineStepState, string> = {
  done: 'Done',
  current: 'In progress',
  waiting: 'Waiting for you',
  failed: 'Failed',
  pending: 'Not started',
  skipped: 'Skipped',
}
const TONE: Record<TimelineStepState, string> = {
  done: 'text-success-text border-state-success/60',
  current: 'text-live-text border-state-live',
  waiting: 'text-warning-text border-state-waiting',
  failed: 'text-danger-text border-danger-line',
  pending: 'text-fg-faint border-line-strong',
  skipped: 'text-fg-faint border-line',
}
</script>

<template>
  <section class="flex flex-col gap-2" aria-labelledby="run-timeline-title" data-testid="run-timeline" :data-state="state">
    <div class="flex flex-wrap items-baseline gap-2">
      <h3 id="run-timeline-title" class="m-0 text-label font-semibold uppercase tracking-wider text-fg-mute">
        Run
      </h3>
      <span class="text-ui-sm font-medium" :class="state === 'failed' ? 'text-danger-text' : state === 'waiting_user' ? 'text-warning-text' : state === 'succeeded' ? 'text-success-text' : state === 'running' ? 'text-live-text' : 'text-fg-soft'" data-testid="run-state">
        {{ RUN_STATE_LABELS[state] }}
      </span>
    </div>
    <ol class="m-0 flex list-none flex-wrap items-center gap-x-1 gap-y-2 p-0">
      <li v-for="(step, i) in steps" :key="step.key" class="flex items-center gap-1" :data-testid="`run-step-${step.key}`" :data-state="step.state">
        <span class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-ui-sm" :class="TONE[step.state]" :aria-current="step.state === 'current' ? 'step' : undefined">
          <span class="relative inline-flex size-3 items-center justify-center" aria-hidden="true">
            <span v-if="step.state === 'current' && step.run?.status === 'running'" class="absolute inset-0 rounded-full motion-working bg-state-live/40" />
            <span class="relative text-[11px] leading-none">{{ GLYPH[step.state] }}</span>
          </span>
          <span class="font-medium">{{ step.label }}</span>
          <span class="sr-only">: {{ WORD[step.state] }}<template v-if="step.role">, {{ RUN_ROLE_LABELS[step.role] }}</template></span>
          <span v-if="failureCategoryOf(step.run)" class="text-label" :data-testid="`run-step-category-${step.key}`">· {{ FAILURE_CATEGORY_LABELS[failureCategoryOf(step.run)!] }}</span>
          <span v-if="step.run?.startedAt" class="hidden font-mono text-label text-fg-faint md:inline" :title="`Started ${formatDateTime(step.run.startedAt)}`">it {{ step.run.iteration }}</span>
        </span>
        <span v-if="i < steps.length - 1" class="text-fg-faint" aria-hidden="true">→</span>
      </li>
    </ol>
    <p
      v-if="problem"
      class="m-0 text-ui-sm"
      :class="problem.step.state === 'failed' ? 'text-danger-text' : 'text-warning-text'"
      data-testid="run-failure"
      :data-category="problem.category ?? 'unclassified'"
    >
      <span class="font-medium">{{ problem.step.label }}: {{ problem.category ? FAILURE_CATEGORY_LABELS[problem.category] : 'failed (unclassified)' }}</span>
      <template v-if="problem.reason">
        — <span class="break-words text-fg-soft">{{ problem.reason }}</span>
      </template>
    </p>
  </section>
</template>
