/*
 * Contracts for GET /api/orchestrations.
 *
 * Hand-mirrored from server/internal/orchestration/derive.go. The generated
 * sdk.generated.ts covers the SSE agent payload only, so these types live here
 * and must be kept in parity with the Go structs by hand — the same arrangement
 * the LocalScope feature uses.
 *
 * Every field below is DERIVED server-side from tasks and task_dependencies.
 * There is no orchestration table, no health score and no ETA, because the
 * pipeline stores no such thing.
 */

export interface OrchestrationCounts {
  total: number
  done: number
  /** Terminal but undelivered — deliberately not folded into `done`. */
  cancelled: number
  /** Tasks on hold. Whether a hold came from a dependency is not stored. */
  blocked: number
  active: number
}

export interface OrchestrationTaskNode {
  id: string
  slug: string
  title: string
  stage: string
  priority: string
  /** Null for the root. */
  parentTaskId: string | null
  /**
   * The stage run that created this task, when an agent did. Null is the
   * honest value for human-created work — not an unknown agent.
   */
  delegatedByStageRunId: string | null
  /** The configured role assigned to run this task. NOT an agent identity. */
  spawnerId: string | null
  projectId: string | null
  /** Derived from the parent chain, not stored. Root is 0. */
  depth: number
}

export interface OrchestrationDependencyEdge {
  id: string
  taskId: string
  dependsOnId: string
  requiredStage: string
}

export interface OrchestrationSummary {
  rootTaskId: string
  title: string
  slug: string
  projectId: string | null
  counts: OrchestrationCounts
  /** Distinct roles across the tree, sorted. Empty when none is assigned. */
  spawnerIds: string[]
  /** Tasks carrying delegation provenance. */
  delegated: number
  updatedAt: string
}

export interface OrchestrationDetail extends OrchestrationSummary {
  tasks: OrchestrationTaskNode[]
  /** Only dependencies with BOTH ends inside this tree. */
  dependencies: OrchestrationDependencyEdge[]
}
