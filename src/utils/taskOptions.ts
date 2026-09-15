import type { TaskAutonomy, TaskPriority } from '../types'

// `satisfies` rather than deriving the unions from these arrays: autonomy and
// priority are wire fields, so the contract has to own the type and the dropdown
// has to prove it covers it. Deriving the other way round would let hiding an
// option silently narrow PipelineTask, with nothing failing to compile.
// (utils/agentGroup.ts derives its unions from the arrays on purpose — AgentSort
// and AgentGroup are client-only view state, never sent to or from the server.)
export const TASK_PRIORITY_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const satisfies readonly { value: TaskPriority, label: string }[]

export const TASK_AUTONOMY_OPTIONS = [
  { value: 'manual', label: 'Manual — you approve each permission request' },
  { value: 'spec_gated', label: 'Spec-gated — pre-approves every tool, including shell' },
  { value: 'full', label: 'Full — pre-approves every tool, including shell' },
] as const satisfies readonly { value: TaskAutonomy, label: string }[]

/*
 * What an autonomy level actually authorises (Phase 4.1), shown beside the
 * selector. spec_gated and full are identical on the server today
 * (taskcontrol.IsAllowAll): every tool is pre-approved for the task's stage
 * agents — shell commands and file writes in its workspace included — and every
 * permission request is approved automatically. Only git push stays blocked.
 */
export const TASK_AUTONOMY_HELP: Record<TaskAutonomy, string> = {
  manual: 'Each permission the agent asks for waits for you in Needs you.',
  spec_gated: 'The task\'s agents can run any shell command and write files in its workspace without asking; every permission request is approved automatically. Only git push stays blocked. The spec is not a permission gate.',
  full: 'The task\'s agents can run any shell command and write files in its workspace without asking; every permission request is approved automatically. Only git push stays blocked.',
}

/** The level new tasks start at: a person approves each permission. */
export const DEFAULT_TASK_AUTONOMY: TaskAutonomy = 'manual'
