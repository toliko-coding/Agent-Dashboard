import type { Agent } from '@/types'

/*
 * The main agent: the one that maintains Agent Dashboard itself.
 *
 * It is a role on the durable agent record, not a property of whatever session
 * happens to be running. That is what makes it permanent: the Manager's Claude
 * session ends, is resumed, or is started fresh in another window, and the role
 * stays where it is — on the agent.
 *
 * There is deliberately no way to set it from here. Nothing in the client
 * designates a main agent, because nothing may: the role is seeded on the
 * server as a single fixed record, so an ordinary agent — Project Intelligence,
 * a Portfolio Developer, a Resume Editor — cannot become main by ticking a box.
 * That is also why this file has no fetch and no writer: there is nothing to
 * choose and nothing to send.
 *
 * It grants nothing. No permission check, ownership check, terminal attach or
 * control path anywhere consults it; it changes how an agent is shown and
 * nothing else.
 */

export const MAIN_AGENT_ROLE = 'main'

/** Is this the agent that maintains Agent Dashboard? */
export function isMainAgent(agent: Pick<Agent, 'role'> | null | undefined): boolean {
  return !!agent && agent.role === MAIN_AGENT_ROLE
}
