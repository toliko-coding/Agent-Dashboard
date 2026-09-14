<script setup lang="ts">
import type { ActiveView } from '@/composables/useViewState'
import type { AttentionItem, AttentionQueue } from '@/features/attention'
import type { Agent } from '@/types'
import { computed } from 'vue'
import { openFolderTrust } from '@/composables/useSpawnWatch'
import { useViewState } from '@/composables/useViewState'
import { useAgents } from '@/features/agents'
import { NeedsYouBand } from '@/features/attention'
import { activeWorkAgents, agentFootprint, liveAgents } from '../commandModel'
import ActiveWork from './ActiveWork.vue'
import ActivityFeedPanel from './ActivityFeedPanel.vue'
import CommandStatusStrip from './CommandStatusStrip.vue'
import GitHubPanel from './GitHubPanel.vue'
import MemoryPanel from './MemoryPanel.vue'
import PipelinePanel from './PipelinePanel.vue'
import ProjectsSummaryPanel from './ProjectsSummaryPanel.vue'
import RoutinesPanel from './RoutinesPanel.vue'
import RuntimeSection from './RuntimeSection.vue'

/*
 * Command: the landing page, ordered by what the user needs to know first.
 *
 *   1. What needs me?              Needs you (the canonical attention queue)
 *   2. What is working?            Active work
 *   3. Where is it happening?      repository → workspace, inside Active work
 *   4. What is the runtime?        Runtime summary and topology
 *   5. What else changed?          recent activity, then the secondary panels
 *
 * A status strip sits above all of it as one instrument. Everything here reads
 * data the app already holds: the agents stream, the queue App.vue derives, and
 * the shared LocalScope snapshot. The detailed service and process lists stay
 * behind the collapsed topology.
 *
 * Retired from this page in 3E (see CHANGELOG): the metric tiles, the static
 * System Map diagram, Quick Actions, the Agents summary and the machine
 * resources panel — each duplicated by the status strip, Active work, the
 * runtime summary, the sidebar or the topbar.
 */
const props = defineProps<{
  /** The canonical queue, derived once in App.vue so every consumer counts the same things. */
  attention: AttentionQueue
}>()
const emit = defineEmits<{ openTask: [taskId: string] }>()

const { activeView } = useViewState()
const { agents, live, lastUpdatedAt, selectAgent } = useAgents({ autoStart: false })

const observed = computed(() => lastUpdatedAt.value !== null)
const attentionItems = computed(() => props.attention.items)
const sessions = computed(() => liveAgents(agents.value))
// Defined once: the strip's count and the section's rows must be the same list.
const working = computed(() => activeWorkAgents(agents.value, attentionItems.value))

function navigate(view: ActiveView): void {
  activeView.value = view
}

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
  else if (subject.type === 'spawn') {
    // Claude's folder trust question has its own decision surface.
    openFolderTrust(subject.pid)
  }
  else {
    activeView.value = 'dashboard'
  }
}

function openAgent(agent: Agent): void {
  selectAgent(agent)
}
</script>

<template>
  <div class="flex flex-col gap-4 min-w-0" data-testid="cockpit">
    <CommandStatusStrip
      :attention="attention"
      :working="observed ? working.length : null"
      :footprint="observed ? agentFootprint(sessions) : null"
      :live="live"
    />

    <NeedsYouBand :queue="attention" @select="openAttention" />

    <ActiveWork
      :agents="observed ? working : []"
      :status="observed ? 'ready' : 'loading'"
      :stale="observed && !live"
      :total-agents="sessions.length"
      @select="openAgent"
    />

    <RuntimeSection :agents="agents" :live-agent-count="sessions.length" />

    <!-- Secondary: what changed, and the work and project context. -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 min-w-0" data-testid="command-secondary">
      <ActivityFeedPanel />
      <PipelinePanel />
      <ProjectsSummaryPanel @navigate="navigate('projects')" />
    </div>

    <!-- Tertiary: configured integrations, each with its own honest state. -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 min-w-0" data-testid="command-integrations">
      <RoutinesPanel />
      <MemoryPanel />
      <GitHubPanel />
    </div>
  </div>
</template>
