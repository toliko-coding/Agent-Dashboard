import type { Agent } from '@/types'
import { describe, expect, it } from 'vitest'
import { isMainAgent, MAIN_AGENT_ROLE } from './useMainAgent'

const agent = (over: Partial<Agent> = {}) => ({ sessionId: 'sess-1', ...over }) as Agent

describe('main agent', () => {
  it('names the agent carrying the main role', () => {
    expect(isMainAgent(agent({ role: MAIN_AGENT_ROLE }))).toBe(true)
  })

  /*
   * Every other agent is an ordinary agent, whatever it is called and wherever
   * it works. Project Intelligence, a Portfolio Developer and a Resume Editor
   * are all simply not main, and there is no client-side way to change that:
   * the role is seeded once on the server, so nothing here can promote an
   * agent by setting a field.
   */
  it('names nothing else, including agents working in the dashboard itself', () => {
    expect(isMainAgent(agent({ role: '' }))).toBe(false)
    expect(isMainAgent(agent({ role: undefined }))).toBe(false)
    expect(isMainAgent(agent({ displayName: 'Project Intelligence' }))).toBe(false)
    expect(isMainAgent(agent({ cwd: '/Users/me/Agent-Dashboard' }))).toBe(false)
    expect(isMainAgent(agent({ role: 'Main' }))).toBe(false)
  })

  it('handles no agent at all', () => {
    expect(isMainAgent(null)).toBe(false)
    expect(isMainAgent(undefined)).toBe(false)
  })

  // The role travels with the agent, not with the session running it: a
  // finished main agent is still the main agent.
  it('does not depend on a session running, or on the dashboard owning one', () => {
    expect(isMainAgent(agent({ role: MAIN_AGENT_ROLE, status: 'finished' }))).toBe(true)
    expect(isMainAgent(agent({ role: MAIN_AGENT_ROLE, dashboardOwned: false }))).toBe(true)
  })
})
