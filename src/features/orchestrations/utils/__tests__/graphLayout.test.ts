import type { OrchestrationDependencyEdge, OrchestrationTaskNode } from '../../types'
import { describe, expect, it } from 'vitest'
import { COLUMN_GAP, edgePath, layoutGraph, NODE_HEIGHT, NODE_WIDTH, PADDING, ROW_GAP } from '../graphLayout'

function node(
  id: string,
  depth: number,
  parentTaskId: string | null,
  extra: Partial<OrchestrationTaskNode> = {},
): OrchestrationTaskNode {
  return {
    id,
    slug: id,
    title: id,
    stage: 'backlog',
    priority: 'medium',
    parentTaskId,
    delegatedByStageRunId: null,
    spawnerId: null,
    projectId: null,
    depth,
    ...extra,
  }
}

function dep(id: string, taskId: string, dependsOnId: string): OrchestrationDependencyEdge {
  return { id, taskId, dependsOnId, requiredStage: 'done' }
}

describe('layoutGraph', () => {
  it('places a lone root at the origin padding', () => {
    const { nodes, width, height } = layoutGraph([node('root', 0, null)], [])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].x).toBe(PADDING)
    expect(nodes[0].y).toBe(PADDING)
    expect(width).toBe(PADDING * 2 + NODE_WIDTH)
    expect(height).toBe(PADDING * 2 + NODE_HEIGHT)
  })

  it('gives an empty graph zero size rather than a padded blank box', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  it('puts each depth in its own column', () => {
    const { nodes } = layoutGraph([
      node('root', 0, null),
      node('child', 1, 'root'),
      node('grand', 2, 'child'),
    ], [])
    expect(nodes.map(n => n.x)).toEqual([
      PADDING,
      PADDING + (NODE_WIDTH + COLUMN_GAP),
      PADDING + 2 * (NODE_WIDTH + COLUMN_GAP),
    ])
  })

  it('stacks siblings in the order the server sent them', () => {
    const { nodes } = layoutGraph([
      node('root', 0, null),
      node('a', 1, 'root'),
      node('b', 1, 'root'),
    ], [])
    const siblings = nodes.filter(n => n.node.depth === 1)
    expect(siblings.map(n => n.node.id)).toEqual(['a', 'b'])
    expect(siblings[0].y).toBe(PADDING)
    expect(siblings[1].y).toBe(PADDING + NODE_HEIGHT + ROW_GAP)
  })

  // The picture must not move under the reader between polls.
  it('is deterministic for the same input', () => {
    const tasks = [node('root', 0, null), node('a', 1, 'root'), node('b', 1, 'root')]
    const deps = [dep('d1', 'b', 'a')]
    expect(layoutGraph(tasks, deps)).toEqual(layoutGraph(tasks, deps))
  })

  // The core requirement: the two relationships must be distinguishable.
  it('marks parent edges as delegation and stored dependencies as dependency', () => {
    const { edges } = layoutGraph([
      node('root', 0, null),
      node('a', 1, 'root'),
      node('b', 1, 'root'),
    ], [dep('d1', 'b', 'a')])

    const delegation = edges.filter(e => e.kind === 'delegation')
    const dependency = edges.filter(e => e.kind === 'dependency')
    expect(delegation).toHaveLength(2)
    expect(dependency).toHaveLength(1)
    expect(dependency[0].id).toBe('dependency:d1')
    expect(dependency[0].label).toBe('done')
    // Delegation edges carry no requiredStage — there is none to report.
    expect(delegation.every(e => e.label === undefined)).toBe(true)
  })

  it('draws a dependency from the blocker toward the blocked task', () => {
    const { nodes, edges } = layoutGraph([
      node('root', 0, null),
      node('a', 1, 'root'),
      node('b', 1, 'root'),
    ], [dep('d1', 'b', 'a')])

    const a = nodes.find(n => n.node.id === 'a')!
    const b = nodes.find(n => n.node.id === 'b')!
    const edge = edges.find(e => e.kind === 'dependency')!
    expect(edge.from.y).toBe(a.y + NODE_HEIGHT / 2)
    expect(edge.to.y).toBe(b.y + NODE_HEIGHT / 2)
  })

  // A dependency with an end outside the tree is real, but it is not part of
  // this graph. The server already drops it; the layout must not invent an
  // anchor for one that slips through.
  it('skips an edge whose endpoint is not in the tree', () => {
    const { edges } = layoutGraph(
      [node('root', 0, null), node('a', 1, 'root')],
      [dep('d1', 'a', 'stranger')],
    )
    expect(edges.filter(e => e.kind === 'dependency')).toHaveLength(0)
  })

  it('skips a parent edge whose parent is not in the tree', () => {
    // Visibility scoping can hand back a child whose parent the caller cannot
    // see; the graph must not draw a line to nowhere.
    const { edges } = layoutGraph([node('orphan', 1, 'invisible-parent')], [])
    expect(edges).toHaveLength(0)
  })

  it('sizes the canvas to the widest column and the deepest level', () => {
    const { width, height } = layoutGraph([
      node('root', 0, null),
      node('a', 1, 'root'),
      node('b', 1, 'root'),
      node('c', 1, 'root'),
    ], [])
    expect(width).toBe(PADDING * 2 + 2 * NODE_WIDTH + COLUMN_GAP)
    expect(height).toBe(PADDING * 2 + 3 * NODE_HEIGHT + 2 * ROW_GAP)
  })
})

describe('edgePath', () => {
  it('produces a horizontal cubic bezier between the two points', () => {
    const d = edgePath({
      id: 'e',
      kind: 'delegation',
      from: { x: 0, y: 10 },
      to: { x: 200, y: 50 },
    })
    expect(d).toMatch(/^M 0 10 C /)
    expect(d.endsWith('200 50')).toBe(true)
  })

  it('keeps a minimum curve even when the two nodes share a column', () => {
    const d = edgePath({
      id: 'e',
      kind: 'dependency',
      from: { x: 100, y: 0 },
      to: { x: 100, y: 60 },
    })
    // dx is clamped to 24, so the control points stay apart and the line does
    // not collapse into an invisible zero-length curve.
    expect(d).toContain('C 124 0')
  })
})
