import { describe, expect, it } from 'vitest'
import { buildAttentionQueue } from './queue'

/*
 * 3M: Claude Code's folder trust question on an agent the dashboard started
 * joins the canonical queue — one blocking item, answered on its own decision
 * surface — instead of a parallel notification system.
 */

const EMPTY = { agents: [], permissionItems: [], capabilityDecisions: [], tasks: [] }

describe('attention queue — folder trust (N)', () => {
  it('adds one blocking item per waiting spawn, naming the folder but never its path', () => {
    const items = buildAttentionQueue({
      ...EMPTY,
      spawnTrust: [{ pid: 4242, cwd: '/Users/me/scratch/plain-folder', since: '2026-09-14T10:00:00Z' }],
    })
    expect(items).toHaveLength(1)
    const [item] = items
    expect(item).toMatchObject({
      id: 'spawn:4242',
      level: 'blocking',
      kind: 'folder-trust',
      subject: { type: 'spawn', pid: 4242 },
      agentSessionId: null,
      workspace: null,
      repository: null,
      detail: 'plain-folder',
      since: '2026-09-14T10:00:00Z',
    })
    expect(JSON.stringify(item)).not.toContain('/Users/me')
  })

  it('has no item without a waiting question', () => {
    expect(buildAttentionQueue({ ...EMPTY, spawnTrust: [] })).toEqual([])
    expect(buildAttentionQueue(EMPTY)).toEqual([])
  })
})
