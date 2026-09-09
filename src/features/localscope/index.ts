/**
 * Public surface of the LocalScope feature.
 *
 * Everything outside this folder imports from here. The client, the wire types
 * and the resource factory are internals: no other feature should know the
 * collector's URL shape or envelope.
 */
export { default as LocalScopeView } from './components/LocalScopeView.vue'
export { default as ServiceCard } from './components/ServiceCard.vue'
// The dashboard's own normalized machine snapshot. Surfaces should prefer
// this over the raw collector client above; the raw one remains for the
// LocalScope page's detailed lists, which have no normalized model yet.
export { useLocalMachine } from './composables/useLocalMachine'
export {
  useLocalScopeDevices,
  useLocalScopeProcesses,
  useLocalScopeServices,
  useLocalScopeSummary,
} from './composables/useLocalScope'
export { useLocalScopeReachable } from './composables/useLocalScopeResource'
export { useMachineProcesses, useMachineServices } from './composables/useMachineLists'
export { EMPTY_PROCESSES, EMPTY_SERVICES, EMPTY_SNAPSHOT, formatAge, hasItems, hasReading } from './snapshot'

export type { DiscoveredProject, Freshness, LocalMachineCounts, LocalMachineDegradation, LocalMachineSnapshot, MachineProcess, MachineProcesses, MachineService, MachineServices, SnapshotSource } from './snapshot'
export { relevanceLabel } from './types'
export type {
  DevDevice,
  DevProcess,
  LocalService,
  ProcessSnapshot,
  RelevanceReason,
  SystemSummary,
} from './types'
