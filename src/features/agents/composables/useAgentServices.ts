import type { MachineService } from '@/features/localscope'
import type { Agent } from '@/types'
import { computed, toValue } from 'vue'
import { useMachineServices } from '@/features/localscope'
import { isPathUnder } from '@/utils/projectAgents'

/*
 * The single correlation between a running agent and the local services
 * LocalScope observed, read through the dashboard's normalized model. The agent card and the workspace diagram both read it,
 * so there is exactly one rule rather than two that can drift apart.
 *
 * The rule is segment-safe path containment, in both directions:
 *
 *   - the service's project root sits inside the agent's cwd — the agent is
 *     working at a repo root and the server runs in a package below it;
 *   - or the agent's cwd sits inside the service's project root — the agent is
 *     working in a subdirectory of the project the server belongs to.
 *
 * Deliberately NOT used, because each produces confident nonsense:
 *   - project-name matching. Agent.projectName is basename(cwd) and collides
 *     across unrelated checkouts, and the discovered project's name is a
 *     folder name too.
 *   - port heuristics (":5173 means Vite means this project").
 *   - process-name matching ("node" is not an identity).
 *
 * PID ownership is not available to correlate on: a LocalService.pid is the
 * listening process, and an agent's pid is the CLI process, which never owns
 * the socket. Nothing reports the parent/child link between them, so there is
 * no PID rule to apply rather than a rule being skipped.
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
export function servicesForAgent(services: MachineService[], agentCwd: string): MachineService[] {
  if (!agentCwd)
    return []
  return services.filter((s) => {
    // Prefer the resolved project root; fall back to the process cwd. Both are
    // absolute paths reported by LocalScope, never inferred here.
    const root = s.discoveredProject?.rootPath ?? s.cwd
    if (!root)
      return false
    return isPathUnder(root, agentCwd) || isPathUnder(agentCwd, root)
  })
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
    items.value === null ? [] : servicesForAgent(items.value, toValue(agent).cwd))

  return { available, services }
}
