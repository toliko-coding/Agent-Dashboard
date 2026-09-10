import type { MachineService } from '@/features/localscope'
import type { Agent, WorkspaceRef } from '@/types'
import { computed, toValue } from 'vue'
import { useMachineServices } from '@/features/localscope'

/*
 * The single correlation between a running agent and the local services
 * LocalScope observed, read through the dashboard's normalized model. The agent
 * card and the workspace diagram both read it, so there is exactly one rule
 * rather than two that can drift apart.
 *
 * The rule is workspace-identity equality:
 *
 *   agent.workspace.id === service.workspace.id
 *
 * Both sides are resolved server-side from an observed cwd, through one shared
 * cached resolver and one shared ref builder, so the two ids are constructed
 * identically or the comparison would be meaningless.
 *
 * WHY NOT PATH CONTAINMENT, which this used to do. Bidirectional segment-safe
 * containment has no concept of a workspace boundary. A linked worktree is the
 * same repository but a DIFFERENT active workspace, with its own branch, its
 * own dirty state and its own services; when worktrees live inside the
 * repository, the worktree's root sits under the main checkout's root and
 * containment reports a match in both directions. An agent on `main` was shown
 * a dev server belonging to a feature branch. That was demonstrated, not
 * suspected — the tests that pinned it are now the acceptance tests for this.
 *
 * WHY NOT REPOSITORY ID. Two worktrees share a repository. Matching on it would
 * reintroduce exactly the defect above through a tidier-looking field.
 *
 * WHY NOTHING ELSE. Not project name (basename(cwd), collides across unrelated
 * checkouts), not the discovered project, not the label, not the port
 * (":5173 means Vite means this project"), not the process name ("node" is not
 * an identity), not cwd containment in any form. PID ownership is unavailable:
 * a service's pid is the listening process, an agent's is the CLI, and nothing
 * reports the link between them.
 *
 * UNKNOWN STAYS UNKNOWN. If either side has no workspace, there is no match —
 * including for a non-git directory, which still receives a real `plain`
 * workspace identity and so participates in the same equality rule rather than
 * a softer one. A false negative leaves a service off a card; a false positive
 * puts another workspace's server on it, which is a claim about the machine
 * that is simply untrue.
 */

export interface AgentServiceCorrelation {
  /**
   * True only when a service list was actually observed. False while the
   * collector is unreachable or has not answered yet — callers render nothing
   * at all in that case rather than an error badge or a zero.
   */
  available: boolean
  /** Correlated services. Meaningful only when `available` is true. */
  services: MachineService[]
}

/** Pure correlation, exported so it can be tested without mounting anything. */
export function servicesForAgent(services: MachineService[], agentWorkspace: WorkspaceRef | null): MachineService[] {
  const id = agentWorkspace?.id
  if (!id)
    return []
  return services.filter(s => s.workspace?.id === id)
}

/**
 * Correlated services for one agent.
 *
 * Reads the SHARED LocalScope services resource, so mounting this for every
 * card on the roster still results in one request — the resource is
 * module-level and ref-counted. Never call the client directly from a card.
 */
export function useAgentServices(agent: (() => Agent) | Agent) {
  const resource = useMachineServices()

  /*
   * Available only when a list was actually observed. `items` is null while the
   * collector has reported nothing — unreachable, or not asked yet — and a null
   * list is not an empty one, so callers render nothing rather than "no
   * services".
   *
   * A stale list still counts as available: it names services that were running
   * moments ago, which is far closer to the truth than showing none.
   *
   * Tested with isArray rather than `!== null` so that anything which is not a
   * list — a response that did not match the contract — is treated as "not
   * known" too. That is the same claim as an unreachable collector, and it
   * keeps a malformed body from reaching the correlation as if it were data.
   */
  const items = computed(() => {
    const value = resource.data.value.items
    return Array.isArray(value) ? value : null
  })

  const available = computed(() => items.value !== null)

  const services = computed<MachineService[]>(() =>
    items.value === null ? [] : servicesForAgent(items.value, toValue(agent).workspace))

  return { available, services }
}
