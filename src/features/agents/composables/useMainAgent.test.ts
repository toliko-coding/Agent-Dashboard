import type { Agent } from '@/types'
import { describe, expect, it } from 'vitest'
import { isMainAgent } from './useMainAgent'

const SID = 'cdc9e4c8-1111-4222-8333-444455556666'
const agent = (over: Partial<Agent> = {}) => ({ sessionId: SID, dashboardOwned: true, ...over }) as Agent

describe('main agent designation', () => {
  it('names the designated agent', () => {
    expect(isMainAgent(agent(), SID)).toBe(true)
  })

  it('names nobody when no agent is designated', () => {
    expect(isMainAgent(agent(), '')).toBe(false)
  })

  it('does not name a different session', () => {
    expect(isMainAgent(agent({ sessionId: 'another-session' }), SID)).toBe(false)
  })

  /*
   * A session id outlives the session it named, and the setting can hold an id
   * typed in by hand. Decorating a Terminal or VS Code session as the
   * dashboard's own maintainer would be a claim about ownership the dashboard
   * cannot make, so the designation shows only on an agent it started.
   */
  it('never designates a session the dashboard did not start', () => {
    expect(isMainAgent(agent({ dashboardOwned: false }), SID)).toBe(false)
    expect(isMainAgent(agent({ dashboardOwned: undefined }), SID)).toBe(false)
  })

  it('handles an agent with no session id, and no agent at all', () => {
    expect(isMainAgent(agent({ sessionId: '' }), SID)).toBe(false)
    expect(isMainAgent(null, SID)).toBe(false)
  })
})
