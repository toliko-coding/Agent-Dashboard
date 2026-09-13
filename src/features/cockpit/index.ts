/**
 * Public surface of the cockpit (Command page) feature, for other features —
 * today the development-only Design Sandbox, which renders the production
 * Command components with example data.
 */
export { activeWorkAgents, agentFootprint, liveAgents, workActivity } from './commandModel'
export type { AgentFootprint, WorkState } from './commandModel'
export { default as ActiveWork } from './components/ActiveWork.vue'
export { default as ActiveWorkRow } from './components/ActiveWorkRow.vue'
export { default as CommandStatusStrip } from './components/CommandStatusStrip.vue'
