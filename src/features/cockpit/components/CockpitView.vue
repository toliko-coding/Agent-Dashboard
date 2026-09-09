<script setup lang="ts">
import type { ActiveView } from '@/composables/useViewState'
import { useViewState } from '@/composables/useViewState'
import ActivityFeedPanel from './ActivityFeedPanel.vue'
import AgentsPanel from './AgentsPanel.vue'
import GitHubPanel from './GitHubPanel.vue'
import MemoryPanel from './MemoryPanel.vue'
import OverviewMetrics from './OverviewMetrics.vue'
import PipelinePanel from './PipelinePanel.vue'
import ProjectsSummaryPanel from './ProjectsSummaryPanel.vue'
import QuickActionsPanel from './QuickActionsPanel.vue'
import RoutinesPanel from './RoutinesPanel.vue'
import SystemMap from './SystemMap.vue'
import SystemResourcesPanel from './SystemResourcesPanel.vue'

/*
 * Overview / command center.
 *
 * Layout order is deliberate: the numbers first, then the shape of the system,
 * then what has been happening, then the existing domain panels — which are
 * kept exactly as they were. Nothing that worked here was removed.
 */
const emit = defineEmits<{ newAgent: [] }>()

const { activeView } = useViewState()

function navigate(view: ActiveView): void {
  activeView.value = view
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="cockpit">
    <OverviewMetrics />

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-3">
      <div class="xl:col-span-2 min-w-0">
        <SystemMap @navigate="navigate" />
      </div>
      <QuickActionsPanel @navigate="navigate" @new-agent="emit('newAgent')" />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <ActivityFeedPanel />
      <SystemResourcesPanel />
      <ProjectsSummaryPanel @navigate="navigate('projects')" />
    </div>

    <!-- Pre-existing panels, unchanged. -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <AgentsPanel />
      <PipelinePanel />
      <RoutinesPanel />
      <MemoryPanel />
      <GitHubPanel />
    </div>
  </div>
</template>
