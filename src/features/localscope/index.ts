/**
 * Public surface of the LocalScope feature.
 *
 * Everything outside this folder imports from here. The client, the wire types
 * and the resource factory are internals: no other feature should know the
 * collector's URL shape or envelope.
 */
export { default as LocalScopeView } from './components/LocalScopeView.vue'
export { default as ServiceCard } from './components/ServiceCard.vue'
export {
  useLocalScopeDevices,
  useLocalScopeProcesses,
  useLocalScopeServices,
  useLocalScopeSummary,
} from './composables/useLocalScope'
export { useLocalScopeReachable } from './composables/useLocalScopeResource'
export { relevanceLabel } from './types'
export type {
  DevDevice,
  DevProcess,
  LocalService,
  ProcessSnapshot,
  RelevanceReason,
  SystemSummary,
} from './types'
