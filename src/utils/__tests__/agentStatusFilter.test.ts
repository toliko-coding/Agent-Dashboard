import type { Agent } from '../../types'
import { describe, expect, it } from 'vitest'
import { AGENT_STATUS_FILTERS, matchesStatusFilter, statusFilterCounts } from '../agentStatusFilter'

function agent(over: Partial<Agent>): Agent {
  return { status: 'idle', working: false, ...over } as Agent
}

describe('agentStatusFilter', () => {
  it('all matches everything', () => {
    for (const a of [agent({ status: 'active' }), agent({ status: 'finished' })])
      expect(matchesStatusFilter(a, 'all')).toBe(true)
  })

  // `working` is a separate boolean from `status`, and an agent mid-turn can
  // still report status 'waiting' or 'idle' — it must read as Running.
  it('running covers both active status and a working agent of any status', () => {
    expect(matchesStatusFilter(agent({ status: 'active' }), 'running')).toBe(true)
    expect(matchesStatusFilter(agent({ status: 'waiting', working: true }), 'running')).toBe(true)
    expect(matchesStatusFilter(agent({ status: 'idle', working: true }), 'running')).toBe(true)
    expect(matchesStatusFilter(agent({ status: 'idle' }), 'running')).toBe(false)
  })

  it('a working agent is not also counted as quiet or idle', () => {
    const working = agent({ status: 'waiting', working: true })
    expect(matchesStatusFilter(working, 'waiting')).toBe(false)
    const busyIdle = agent({ status: 'idle', working: true })
    expect(matchesStatusFilter(busyIdle, 'idle')).toBe(false)
  })

  it('waiting, idle and completed map to their statuses', () => {
    expect(matchesStatusFilter(agent({ status: 'waiting' }), 'waiting')).toBe(true)
    expect(matchesStatusFilter(agent({ status: 'idle' }), 'idle')).toBe(true)
    expect(matchesStatusFilter(agent({ status: 'finished' }), 'completed')).toBe(true)
    expect(matchesStatusFilter(agent({ status: 'active' }), 'completed')).toBe(false)
  })

  it('buckets partition the roster — every agent lands in exactly one', () => {
    const roster = [
      agent({ status: 'active' }),
      agent({ status: 'waiting', working: true }),
      agent({ status: 'waiting' }),
      agent({ status: 'idle' }),
      agent({ status: 'finished' }),
    ]
    for (const a of roster) {
      const hits = (['running', 'waiting', 'idle', 'completed'] as const)
        .filter(f => matchesStatusFilter(a, f))
      expect(hits).toHaveLength(1)
    }
  })

  it('counts each bucket', () => {
    const counts = statusFilterCounts([
      agent({ status: 'active' }),
      agent({ status: 'idle', working: true }),
      agent({ status: 'waiting' }),
      agent({ status: 'idle' }),
      agent({ status: 'finished' }),
    ])
    expect(counts).toEqual({ all: 5, running: 2, waiting: 1, idle: 1, completed: 1 })
  })

  it('exposes All first and labels waiting as Quiet, matching statusLabel', () => {
    expect(AGENT_STATUS_FILTERS[0].value).toBe('all')
    expect(AGENT_STATUS_FILTERS.find(f => f.value === 'waiting')?.label).toBe('Quiet')
  })
})
