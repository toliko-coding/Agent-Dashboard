<script setup lang="ts">
import type { ActiveView } from '@/composables/useViewState'
import type { AttentionItem, AttentionQueue } from '@/features/attention'
import { useViewState } from '@/composables/useViewState'
import { useAgents } from '@/features/agents'
import { NeedsYouBand } from '@/features/attention'
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
 * Layout order is deliberate: what needs the user first, then the numbers, then
 * the shape of the system, then what has been happening, then the existing
 * domain panels — which are kept exactly as they were. Nothing that worked
 * here was removed.
 */
defineProps<{
  /** The canonical queue, derived once in App.vue so every consumer counts the same things. */
  attention: AttentionQueue
}>()
const emit = defineEmits<{ newAgent: [], openTask: [taskId: string] }>()

const { activeView } = useViewState()
const { agents, selectAgent } = useAgents({ autoStart: false })

/*
 * An item opens the surface where it is dealt with, through the patterns that
 * already exist: an agent's detail modal, a task's modal (App.vue routes plan
 * reviews to their own panel), and the Agents view for capability decisions,
 * whose triage band is where they are answered. Nothing is approved from here.
 */
function openAttention(item: AttentionItem): void {
  const subject = item.subject
  if (subject.type === 'agent') {
    const agent = agents.value.find(a => a.sessionId === subject.sessionId)
    if (agent)
      selectAgent(agent)
  }
  else if (subject.type === 'task') {
    emit('openTask', subject.taskId)
  }
  else {
    activeView.value = 'dashboard'
  }
}

function navigate(view: ActiveView): void {
  activeView.value = view
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="cockpit">
    <NeedsYouBand :queue="attention" @select="openAttention" />

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
