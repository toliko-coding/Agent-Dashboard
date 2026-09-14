/**
 * Public surface of the cockpit (Command page) feature, for other features —
 * the development-only Design Sandbox, which renders the production Command
 * components with example data, and the Runtime page, which draws the same
 * runtime topology as its Workspaces section.
 */
export { activeWorkAgents, agentFootprint, liveAgents, workActivity } from './commandModel'
export type { AgentFootprint, WorkState } from './commandModel'
export { default as ActiveWork } from './components/ActiveWork.vue'
export { default as ActiveWorkRow } from './components/ActiveWorkRow.vue'
export { default as CommandStatusStrip } from './components/CommandStatusStrip.vue'
export { default as RuntimeTopologyTree } from './components/RuntimeTopologyTree.vue'
