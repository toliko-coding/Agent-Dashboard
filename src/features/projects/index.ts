// Public surface of the projects feature (Phase 4B adds Project Intelligence).
export { default as ProjectIntelligenceView } from './roadmap/ProjectIntelligenceView.vue'
export type { ProjectRoadmapSummary, Roadmap, RoadmapPhase, RoadmapStatus } from './roadmap/roadmapModel'
export { STATUS_GLYPHS, STATUS_LABELS } from './roadmap/roadmapModel'
export { fetchRoadmapSummaries, selectedProjectId } from './roadmap/useRoadmap'
