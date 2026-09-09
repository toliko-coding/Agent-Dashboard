import type { LocalService } from '@/features/localscope'
import type { Agent } from '@/types'
import { computed, toValue } from 'vue'
import { useLocalScopeServices } from '@/features/localscope'
import { isPathUnder } from '@/utils/projectAgents'

/*
 * The single correlation between a running agent and the local services
 * LocalScope observed. The agent card and the workspace diagram both read it,
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
 *     across unrelated checkouts, and LocalScope's own ProjectRef.name is a
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
   * True only when LocalScope actually answered. False while it is
   * unreachable, still loading, or erroring — callers render nothing at all in
   * that case rather than an error badge or a zero.
   */
  available: boolean
  /** Correlated services. Meaningful only when `available` is true. */
  services: LocalService[]
}

/** Pure correlation, exported so it can be tested without mounting anything. */
export function servicesForAgent(services: LocalService[], agentCwd: string): LocalService[] {
  if (!agentCwd)
    return []
  return services.filter((s) => {
    // Prefer the resolved project root; fall back to the process cwd. Both are
    // absolute paths reported by LocalScope, never inferred here.
    const root = s.project?.rootPath ?? s.cwd
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
  const resource = useLocalScopeServices()

  const available = computed(() =>
    resource.reachable.value === true && resource.error.value === null && resource.data.value !== null)

  const services = computed<LocalService[]>(() => {
    if (!available.value)
      return []
    return servicesForAgent(resource.data.value ?? [], toValue(agent).cwd)
  })

  return { available, services }
}
