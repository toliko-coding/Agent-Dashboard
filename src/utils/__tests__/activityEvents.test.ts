import type { AuditEntry } from '../../types'
import { describe, expect, it } from 'vitest'
import { severityForAction, toActivityEvent, toActivityFeed } from '../activityEvents'

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'a1',
    taskId: null,
    userId: null,
    actor: 'system',
    action: 'live_inject',
    target: 'pid:53468',
    timestamp: '2026-09-09T01:27:46+03:00',
    details: null,
    ...over,
  }
}

describe('activityEvents', () => {
  it('maps a known action to a human title and keeps the raw action', () => {
    const e = toActivityEvent(entry())
    expect(e.title).toBe('Message sent to agent')
    expect(e.action).toBe('live_inject')
    expect(e.detail).toBe('pid:53468')
    expect(e.actor).toBe('system')
  })

  // A server that adds an action must not have its events silently vanish.
  it('falls back to a humanized name for an unmapped action', () => {
    const e = toActivityEvent(entry({ action: 'stage_advanced' }))
    expect(e.title).toBe('Stage advanced')
    expect(e.severity).toBe('info')
  })

  it('assigns severity by action, defaulting to info', () => {
    expect(severityForAction('spawn')).toBe('success')
    expect(severityForAction('spawn_rejected')).toBe('danger')
    expect(severityForAction('task_cancelled')).toBe('warning')
    expect(severityForAction('something_new')).toBe('info')
  })

  it('orders newest first', () => {
    const feed = toActivityFeed([
      entry({ id: 'old', timestamp: '2026-09-09T01:00:00+03:00' }),
      entry({ id: 'new', timestamp: '2026-09-09T02:00:00+03:00' }),
      entry({ id: 'mid', timestamp: '2026-09-09T01:30:00+03:00' }),
    ])
    expect(feed.map(e => e.id)).toEqual(['new', 'mid', 'old'])
  })

  it('keeps an unparseable timestamp instead of dropping the event', () => {
    const feed = toActivityFeed([
      entry({ id: 'good', timestamp: '2026-09-09T02:00:00+03:00' }),
      entry({ id: 'bad', timestamp: 'not-a-date' }),
    ])
    expect(feed.map(e => e.id)).toEqual(['good', 'bad'])
    expect(Number.isNaN(feed[1].timestamp)).toBe(true)
  })

  it('carries the task id through when the row named one', () => {
    expect(toActivityEvent(entry({ taskId: 't-1' })).taskId).toBe('t-1')
    expect(toActivityEvent(entry({ taskId: null })).taskId).toBeUndefined()
  })

  it('normalizes an empty page to an empty feed', () => {
    expect(toActivityFeed([])).toEqual([])
  })
})
