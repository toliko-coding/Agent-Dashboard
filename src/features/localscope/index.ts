/**
 * Public surface of the LocalScope feature.
 *
 * Everything outside this folder imports from here, and everything exported
 * here is a dashboard-owned model. The collector's client, its wire types and
 * its envelope are internals: no other feature knows LocalScope's URL shape,
 * its response format, or that it is a separate process at all.
 */
export { default as LocalScopeView } from './components/LocalScopeView.vue'
export { default as ServiceCard } from './components/ServiceCard.vue'
export { useLocalMachine } from './composables/useLocalMachine'
export { useMachineDevices, useMachineProcesses, useMachineServices } from './composables/useMachineLists'
export {
  EMPTY_DEVICES,
  EMPTY_PROCESSES,
  EMPTY_SERVICES,
  EMPTY_SNAPSHOT,
  formatAge,
  freshnessNote,
  hasItems,
  hasReading,
} from './snapshot'

export type {
  DiscoveredProject,
  Freshness,
  LocalMachineCounts,
  LocalMachineDegradation,
  LocalMachineSnapshot,
  MachineDevice,
  MachineDevices,
  MachineProcess,
  MachineProcesses,
  MachineService,
  MachineServices,
  SnapshotSource,
} from './snapshot'
export { relevanceLabel } from './types'
