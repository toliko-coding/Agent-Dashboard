import type { MachineProcess, MachineProcesses } from '@/features/localscope'
import type { Agent, WorkspaceRef } from '@/types'
import { computed, toValue } from 'vue'
import { EMPTY_PROCESSES, useMachineProcesses } from '@/features/localscope'

/*
 * The processes running in an agent's workspace.
 *
 * Same rule as services, deliberately and to the letter:
 *
 *   agent.workspace.id === process.workspace.id
 *
 * Nothing else participates. Not cwd containment, not the repository id (two
 * worktrees share one), not the process name, the command, the runtime, the
 * ports, or LocalScope's project name. A process that cannot be identified is
 * left unattributed rather than attached to the nearest plausible agent.
 *
 * The states mirror the service composable for the same reason the rule does:
 * a user reading an agent's workspace should not have to learn that "no
 * processes" means something subtly different here than it does one section up.
 */

export type ProcessAttribution = 'source-unavailable' | 'agent-unresolved' | 'resolved'

/** Pure matching, exported so it can be tested without mounting anything. */
export function processesForAgent(processes: MachineProcess[], agentWorkspace: WorkspaceRef | null): MachineProcess[] {
  const id = agentWorkspace?.id
  if (!id)
    return []
  return processes.filter(p => p.workspace?.id === id)
}

/** Observations the collector reported but nothing could attribute. */
export function unresolvedProcessCount(processes: MachineProcess[]): number {
  return processes.filter(p => !p.workspace?.id).length
}

export function useAgentProcesses(agent: (() => Agent) | Agent) {
  const resource = useMachineProcesses()

  /*
   * isArray rather than `!== null`, so a body that did not match the contract
   * is treated as "not known" too. That is the same claim as an unreachable
   * collector, and it keeps a malformed response from reaching the matching as
   * if it were data.
   */
  const items = computed(() => {
    const value = resource.data.value.items
    return Array.isArray(value) ? value : null
  })

  const attribution = computed<ProcessAttribution>(() => {
    if (items.value === null)
      return 'source-unavailable'
    if (!toValue(agent).workspace?.id)
      return 'agent-unresolved'
    return 'resolved'
  })

  const processes = computed<MachineProcess[]>(() =>
    attribution.value === 'resolved' ? processesForAgent(items.value!, toValue(agent).workspace) : [])

  const unresolvedCount = computed(() =>
    attribution.value === 'resolved' ? unresolvedProcessCount(items.value!) : 0)

  /*
   * The reading itself, passed through untouched so the section can state its
   * own freshness with the shared indicator. Deliberately NOT reinterpreted
   * here: stale and degraded already mean something exact everywhere else, and
   * a second interpretation is how two surfaces start disagreeing about the
   * same moment.
   */
  const reading = computed<MachineProcesses>(() => resource.data.value ?? EMPTY_PROCESSES)

  return { attribution, processes, unresolvedCount, reading }
}
