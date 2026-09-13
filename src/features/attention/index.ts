/**
 * Public surface of the attention feature: the one queue of things that need
 * the user, and the Overview band that shows it.
 */
export { default as NeedsYouBand } from './components/NeedsYouBand.vue'
export {
  agentTitle,
  ATTENTION_LEVELS,
  attentionQueueState,
  buildAttentionQueue,
  compareAttention,
} from './queue'
export type {
  AttentionItem,
  AttentionKind,
  AttentionLevel,
  AttentionQueue,
  AttentionSources,
  AttentionStatus,
  AttentionSubject,
} from './queue'
export { useAttentionQueue } from './useAttentionQueue'
