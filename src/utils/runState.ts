import type { PipelineStage, PipelineTask, StageRun, StageRunFailureCategory, StageRunStatus } from '@/types'

/*
 * The canonical run view over the task pipeline (ADR-0014).
 *
 * A Phase 4 "run" is a pipeline task and its stage runs — the persisted,
 * dashboard-owned state. Everything here is derived from those fields only:
 * never from a transcript, a process being visible, or elapsed time.
 */

export const RUN_STATES = ['queued', 'preparing', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled'] as const
export type RunState = typeof RUN_STATES[number]

export const RUN_STATE_LABELS: Record<RunState, string> = {
  queued: 'Queued',
  preparing: 'Preparing',
  running: 'Running',
  waiting_user: 'Waiting for you',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** The role a stage plays in a run. */
export type RunRole = 'planner' | 'developer' | 'reviewer' | 'finalizer'

const STAGE_ROLES: Partial<Record<PipelineStage, RunRole>> = {
  backlog: 'planner',
  plan_review: 'planner',
  implementation: 'developer',
  self_review: 'reviewer',
  finalization: 'finalizer',
}

export const RUN_ROLE_LABELS: Record<RunRole, string> = {
  planner: 'Planner',
  developer: 'Developer',
  reviewer: 'Reviewer',
  finalizer: 'Finalizer',
}

export function stageRole(stage: PipelineStage): RunRole | null {
  return STAGE_ROLES[stage] ?? null
}

type TaskFacts = Pick<PipelineTask, 'currentStage' | 'latestStageRunStatus' | 'needsUser'> & {
  blockedByPendingPermissions?: boolean
}

const STATUS_STATES: Record<StageRunStatus, RunState> = {
  pending: 'preparing',
  requeued: 'preparing',
  running: 'running',
  awaiting_user: 'waiting_user',
  on_hold: 'waiting_user',
  failed: 'failed',
  // A finished stage whose successor has not been created yet.
  done: 'preparing',
}

/** The run state of a task, from its persisted stage and latest stage-run status. */
export function runStateOf(task: TaskFacts): RunState {
  if (task.currentStage === 'cancelled')
    return 'cancelled'
  if (task.currentStage === 'done')
    return 'succeeded'
  if (task.blockedByPendingPermissions)
    return 'waiting_user'
  const status = task.latestStageRunStatus ?? null
  if (status === null)
    return task.currentStage === 'backlog' || task.currentStage === 'ready' ? 'queued' : 'preparing'
  return STATUS_STATES[status]
}

/** A person-readable name per persisted failure category (Phase 4.1). */
export const FAILURE_CATEGORY_LABELS: Record<StageRunFailureCategory, string> = {
  spawn_failed: 'Agent could not start',
  permission_required: 'Needed a permission',
  agent_failed: 'Agent failed',
  agent_disappeared: 'Agent process disappeared',
  workspace_unavailable: 'Workspace unavailable',
  timeout: 'Timed out',
  invalid_result: 'Invalid result',
  cancelled: 'Cancelled',
}

/**
 * The failure category the server persisted on a stage run, where the failure
 * was known (ADR-0014 §7). Never inferred from error text: an unclassified or
 * unknown value is null.
 */
export function failureCategoryOf(run: Pick<StageRun, 'failureCategory'> | null | undefined): StageRunFailureCategory | null {
  const category = run?.failureCategory ?? null
  return category !== null && Object.hasOwn(FAILURE_CATEGORY_LABELS, category) ? category : null
}

/** The human reason the server recorded with a failure (output.error), if any. */
export function failureReasonOf(run: Pick<StageRun, 'output'> | null | undefined): string | null {
  const reason = run?.output?.error ?? run?.output?.validation_error
  return typeof reason === 'string' && reason.trim() ? reason : null
}

export type TimelineStepState = 'done' | 'current' | 'waiting' | 'failed' | 'pending' | 'skipped'

export interface TimelineStep {
  key: string
  label: string
  role: RunRole | null
  state: TimelineStepState
  run: StageRun | null
}

const AGENT_STAGES: PipelineStage[] = ['implementation', 'self_review', 'finalization']
const STAGE_TITLES: Partial<Record<PipelineStage, string>> = {
  implementation: 'Developer',
  self_review: 'Reviewer',
  finalization: 'Finalization',
}

/**
 * Queued → Preparing → Developer → Reviewer → Finalization → Result, from the
 * task and its stage runs. A stage's step uses its latest run (highest
 * iteration, then latest start). Nothing is marked done without a done run.
 */
export function runTimeline(task: TaskFacts, stageRuns: StageRun[]): TimelineStep[] {
  const state = runStateOf(task)
  const latest = new Map<PipelineStage, StageRun>()
  for (const run of stageRuns) {
    const prev = latest.get(run.stage)
    if (!prev || run.iteration > prev.iteration || (run.iteration === prev.iteration && (run.startedAt ?? '') > (prev.startedAt ?? '')))
      latest.set(run.stage, run)
  }
  const anyRun = stageRuns.length > 0
  const steps: TimelineStep[] = [
    { key: 'queued', label: 'Queued', role: null, state: 'done', run: null },
    { key: 'preparing', label: 'Preparing', role: null, state: anyRun ? 'done' : state === 'queued' ? 'pending' : 'current', run: null },
  ]
  if (state === 'queued')
    steps[0].state = 'current'
  for (const stage of AGENT_STAGES) {
    const run = latest.get(stage) ?? null
    let stepState: TimelineStepState = 'pending'
    if (run && run.status === 'failed' && task.blockedByPendingPermissions && task.currentStage === stage) {
      // Parked on permission requests: the pipeline restarts this run once they are answered.
      stepState = 'waiting'
    }
    else if (run) {
      stepState = run.status === 'done'
        ? 'done'
        : run.status === 'failed'
          ? 'failed'
          : run.status === 'awaiting_user' || run.status === 'on_hold'
            ? 'waiting'
            : 'current'
    }
    else if (task.currentStage === 'done' || (anyRun && AGENT_STAGES.indexOf(stage) < AGENT_STAGES.indexOf(task.currentStage as PipelineStage) && task.currentStage !== 'cancelled')) {
      stepState = 'skipped'
    }
    steps.push({ key: stage, label: STAGE_TITLES[stage]!, role: stageRole(stage), state: stepState, run })
  }
  steps.push({
    key: 'result',
    label: 'Result',
    role: null,
    state: state === 'succeeded' ? 'done' : state === 'failed' ? 'failed' : state === 'cancelled' ? 'skipped' : 'pending',
    run: null,
  })
  return steps
}
