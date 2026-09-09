import type { OrchestrationDependencyEdge, OrchestrationTaskNode } from '../types'

/*
 * Deterministic layout for the orchestration graph.
 *
 * Pure and force-free on purpose: the same tree must produce the same picture
 * on every render and in every tab. A force simulation would make the graph
 * shift under the reader on each poll, and would make this untestable.
 *
 * Nodes are laid out by their DERIVED depth (a column per level, parent left of
 * child) and, within a level, in the order the server sent them — which is
 * parent-before-child then oldest-first. Nothing about the position is read
 * from or written to the server.
 */

export const NODE_WIDTH = 168
export const NODE_HEIGHT = 44
export const COLUMN_GAP = 72
export const ROW_GAP = 16
export const PADDING = 16

export interface LaidOutNode {
  node: OrchestrationTaskNode
  x: number
  y: number
  width: number
  height: number
}

/**
 * An edge to draw. `kind` decides the stroke: a delegation edge (parent→child)
 * is solid, a dependency edge is dashed. The two are different relationships
 * and must never render alike.
 */
export interface LaidOutEdge {
  id: string
  kind: 'delegation' | 'dependency'
  from: { x: number, y: number }
  to: { x: number, y: number }
  /** The requiredStage of a dependency edge; undefined for delegation. */
  label?: string
}

export interface GraphLayout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  width: number
  height: number
}

/** Right-edge midpoint — where an edge leaves a node. */
function exitPoint(n: LaidOutNode): { x: number, y: number } {
  return { x: n.x + n.width, y: n.y + n.height / 2 }
}

/** Left-edge midpoint — where an edge enters a node. */
function entryPoint(n: LaidOutNode): { x: number, y: number } {
  return { x: n.x, y: n.y + n.height / 2 }
}

export function layoutGraph(
  tasks: OrchestrationTaskNode[],
  dependencies: OrchestrationDependencyEdge[],
): GraphLayout {
  const byDepth = new Map<number, OrchestrationTaskNode[]>()
  for (const t of tasks) {
    const bucket = byDepth.get(t.depth)
    if (bucket)
      bucket.push(t)
    else
      byDepth.set(t.depth, [t])
  }

  const placed = new Map<string, LaidOutNode>()
  const nodes: LaidOutNode[] = []
  let maxRows = 0

  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
    const column = byDepth.get(depth) ?? []
    maxRows = Math.max(maxRows, column.length)
    column.forEach((node, row) => {
      const laid: LaidOutNode = {
        node,
        x: PADDING + depth * (NODE_WIDTH + COLUMN_GAP),
        y: PADDING + row * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }
      placed.set(node.id, laid)
      nodes.push(laid)
    })
  }

  const edges: LaidOutEdge[] = []

  // Delegation edges come from parentTaskId, which the server derived the tree
  // from — so they always resolve.
  for (const t of tasks) {
    if (!t.parentTaskId)
      continue
    const parent = placed.get(t.parentTaskId)
    const child = placed.get(t.id)
    if (!parent || !child)
      continue
    edges.push({
      id: `delegation:${t.parentTaskId}->${t.id}`,
      kind: 'delegation',
      from: exitPoint(parent),
      to: entryPoint(child),
    })
  }

  // Dependency edges point from the dependency to the dependent, so the arrow
  // reads "this must finish before that".
  for (const d of dependencies) {
    const from = placed.get(d.dependsOnId)
    const to = placed.get(d.taskId)
    if (!from || !to)
      continue
    edges.push({
      id: `dependency:${d.id}`,
      kind: 'dependency',
      from: exitPoint(from),
      to: entryPoint(to),
      label: d.requiredStage,
    })
  }

  const depths = byDepth.size
  return {
    nodes,
    edges,
    width: depths === 0
      ? 0
      : PADDING * 2 + depths * NODE_WIDTH + (depths - 1) * COLUMN_GAP,
    height: maxRows === 0
      ? 0
      : PADDING * 2 + maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP,
  }
}

/**
 * A cubic bezier between two points, curving horizontally. Straight lines
 * overlap indistinguishably once several children share a parent column.
 */
export function edgePath(edge: LaidOutEdge): string {
  const dx = Math.max(24, (edge.to.x - edge.from.x) / 2)
  return `M ${edge.from.x} ${edge.from.y} `
    + `C ${edge.from.x + dx} ${edge.from.y}, `
    + `${edge.to.x - dx} ${edge.to.y}, `
    + `${edge.to.x} ${edge.to.y}`
}
