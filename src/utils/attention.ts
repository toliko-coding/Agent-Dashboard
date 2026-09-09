import type { Agent } from '../types'
import type { AgentStateInfo } from './agentState'
import { agentState, isGrantable } from './agentState'

/*
 * The triage band's view of an agent, projected from the one semantic
 * classifier in agentState.ts.
 *
 * This module used to own its own rules, which is how the band and the agent
 * card came to disagree about the same object. It now only renames the shared
 * state into the band's vocabulary; nothing here decides anything.
 */

export interface Attention {
  kind: 'question' | 'permission' | 'error' | 'stalled' | 'yourTurn'
  label: string
  tone: 'warning' | 'danger' | 'neutral'
  weight: number
  /**
   * Whether this is evidence a permission prompt is on screen AND names the
   * call, so the band may offer a standing grant for it. See
   * agentState.isGrantable for why a detected dialog does not qualify.
   */
  grantable: boolean
}

/** Band vocabulary for each semantic state. Presentation only. */
const KIND: Partial<Record<AgentStateInfo['state'], Attention['kind']>> = {
  waiting_for_user: 'question',
  permission_required: 'permission',
  error: 'error',
  stalled: 'stalled',
  awaiting_input: 'yourTurn',
  // Same band vocabulary: the turn is over either way, and the band has never
  // distinguished a freshly finished turn from a long-quiet one.
  idle: 'yourTurn',
}

const WEIGHT: Record<Attention['kind'], number> = {
  question: -1,
  permission: 0,
  error: 1,
  stalled: 2,
  yourTurn: 3,
}

export function attentionFor(agent: Agent, secondsSinceActivity: number | null): Attention | null {
  const info = agentState(agent, secondsSinceActivity)
  const kind = KIND[info.state]
  if (!kind)
    return null
  return {
    kind,
    // The band has never distinguished a freshly finished turn from a
    // long-quiet one, so both read "Your turn" here even though the card can
    // now tell them apart.
    label: info.state === 'idle' ? 'Your turn' : info.label,
    tone: info.tone === 'info' ? 'neutral' : info.tone,
    weight: WEIGHT[kind],
    grantable: isGrantable(agent, secondsSinceActivity),
  }
}

export { needsAttention, sortByTriage } from './agentState'
