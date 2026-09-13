import type { Agent } from '../types'

/*
 * Per-agent attention evidence: which of an agent's own signals says the user
 * has to act, and whether that prompt may be answered with a standing grant.
 *
 * This is the classifier underneath the canonical attention queue
 * (features/attention/queue.ts), and nothing outside that queue decides whether
 * an agent needs the user. It has no clock and no notion of "your turn" or
 * "stalled", on purpose: a finished turn is the resting state of every
 * interactive session, and silence with an unresolved tool call is also a long
 * build. Both used to live here and made idle and busy agents read as requests.
 */
export interface Attention {
  kind: 'question' | 'permission' | 'error'
  label: string
  tone: 'warning' | 'danger'
  // Whether this kind is evidence that a PERMISSION prompt is on screen — the
  // only basis on which the triage band may offer a standing grant for the
  // agent's pending tool call. A question is answered, never granted: its
  // prompt is about something else entirely, so treating it as evidence would
  // offer a rule for a tool nobody asked about. A required field so a future
  // kind must decide this explicitly instead of inheriting it by default.
  grantable: boolean
}

const ASK_USER_QUESTION_TOOL = 'AskUserQuestion'

export function attentionFor(agent: Agent): Attention | null {
  // A finished agent's process is gone: its reconstructed errorState/pendingToolUse
  // are historical and not actionable (dismiss lives on the card).
  if (agent.status === 'finished')
    return null
  // A real, answerable AskUserQuestion outranks a generic permission prompt.
  if (agent.pendingQuestion)
    return { kind: 'question', label: 'Question', tone: 'warning', grantable: false }
  // The review/submit screen is equally answerable and equally blocking: the
  // session sits there until someone presses a key.
  if (agent.pendingConfirm)
    return { kind: 'question', label: 'Confirm answers', tone: 'warning', grantable: false }
  // A PreToolUse hook call the bridge is holding open: the session is blocked
  // right now and one click releases or refuses it. Ranked above a pipeline
  // request because it expires — nobody answering means the run falls back to
  // its terminal, where the dashboard can no longer help.
  if (agent.heldPermissions && agent.heldPermissions.length > 0)
    return { kind: 'permission', label: 'Awaiting your decision', tone: 'warning', grantable: true }
  // A pipeline stage run's stored request: answered through the task's approve
  // control, which also records the decision against the task.
  if (agent.pendingPermissions && agent.pendingPermissions.length > 0)
    return { kind: 'permission', label: 'Needs permission', tone: 'warning', grantable: true }
  // The session is showing its own prompt: the bridge lapsed before anyone
  // decided, or is not installed for it. Not answerable from here — but it is
  // the one signal that positively means a permission prompt is on screen.
  //
  // A standing rule for next time is only honest when the prompt and the tool
  // the button would name are the same call. The notice fires once when the
  // prompt opens and never when it is answered, so it outlives its prompt,
  // while pendingToolUse is derived independently from the transcript — the
  // pair drifts, and the grant would be for a tool nobody asked about. The
  // bridge names the call when it held it; without that name there is no
  // evidence to offer a rule on.
  if (agent.awaitingTerminalPermission) {
    const named = Boolean(agent.terminalPermissionToolUseId)
      && agent.terminalPermissionToolUseId === agent.pendingToolUse?.id
    return { kind: 'permission', label: 'Answer in terminal', tone: 'warning', grantable: named }
  }
  // An unanswered AskUserQuestion in a session whose screen cannot be read.
  // Unlike any other unresolved tool call this one cannot be a long-running
  // tool: it completes only when a person answers. It used to surface only
  // after three minutes of silence, through the retired stall heuristic.
  if (agent.pendingToolUse?.tool === ASK_USER_QUESTION_TOOL)
    return { kind: 'question', label: 'Question in terminal', tone: 'warning', grantable: false }
  // A classified API error, on a session that is not working. The parser never
  // clears errorState when a later request succeeds, so a working session's
  // error is history, not a failure to report.
  if (agent.errorState && !agent.working)
    return { kind: 'error', label: 'Run failed', tone: 'danger', grantable: false }
  return null
}
