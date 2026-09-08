<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import { useNow } from '@/composables/useNow'
import { formatUptime, secondsSince } from '@/utils/format'
import { agentDisplayStatus, statusLabel } from '@/utils/statusColors'
import AgentDiagram from './AgentDiagram.vue'

/*
 * The left column of the agent workspace: what this agent IS and is doing,
 * beside the conversation rather than hidden behind a tab.
 *
 * Every section renders only when its data exists. In particular there is no
 * phase number: a phase is only real for a pipeline-linked agent, and the
 * TodoWrite items shown here are tasks the session wrote, whose count changes
 * as it writes more.
 */
const props = defineProps<{ agent: Agent }>()

const { nowMs } = useNow()

const displayStatus = computed(() => agentDisplayStatus(props.agent))

const taskProgress = computed(() => {
  const tasks = props.agent.tasks
  if (tasks.length === 0)
    return null
  const done = tasks.filter(t => t.status === 'completed').length
  return { done, total: tasks.length, pct: Math.round((done / tasks.length) * 100) }
})

/** The task the session marked in_progress, if it named one. */
const currentTask = computed(() =>
  props.agent.tasks.find(t => t.status === 'in_progress')?.subject ?? null)

const lastActivity = computed(() => {
  // secondsSince returns null when the server sent no parseable timestamp.
  const secs = secondsSince(props.agent.lastActivity, nowMs.value)
  return secs === null || !Number.isFinite(secs) ? null : formatUptime(secs)
})

const recentTools = computed(() => props.agent.lastTools.slice(-4).reverse())
</script>

<template>
  <aside
    class="flex flex-col gap-4 overflow-y-auto p-4 border-r border-line bg-app min-w-0"
    aria-label="Agent intelligence"
    data-testid="agent-intelligence"
  >
    <!-- State -->
    <section class="flex flex-col gap-1.5">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Agent state
      </h3>
      <div class="flex items-center gap-2">
        <AppBadge :variant="displayStatus" />
        <span v-if="agent.errorState" class="text-[11px] text-danger-text">{{ agent.errorState }}</span>
      </div>
      <p class="text-[11px] text-fg-mute">
        {{ statusLabel(displayStatus) }}<span v-if="lastActivity"> · last activity {{ lastActivity }} ago</span>
      </p>
    </section>

    <!-- Diagram: real relationships only -->
    <section class="flex flex-col gap-1">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Connections
      </h3>
      <AgentDiagram :agent="agent" />
    </section>

    <!-- Task progress, only when the session wrote TodoWrite items -->
    <section v-if="taskProgress" class="flex flex-col gap-1.5" data-testid="intelligence-tasks">
      <div class="flex items-baseline gap-2">
        <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
          Tasks
        </h3>
        <span class="ml-auto text-[11px] font-mono tabular-nums text-fg-soft">
          {{ taskProgress.done }} / {{ taskProgress.total }} complete
        </span>
      </div>
      <span class="h-1.5 bg-raised rounded-full overflow-hidden">
        <span
          class="block h-full rounded-full bg-accent transition-[width] duration-[var(--duration-base)] ease-standard"
          :style="{ width: `${taskProgress.pct}%` }"
        />
      </span>
    </section>

    <section v-if="currentTask" class="flex flex-col gap-1" data-testid="intelligence-current-task">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Current task
      </h3>
      <p class="text-[12px] text-fg-soft leading-snug">
        {{ currentTask }}
      </p>
    </section>

    <!-- Project -->
    <section class="flex flex-col gap-1">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Project
      </h3>
      <p class="text-[12px] text-fg">
        {{ agent.projectName }}
      </p>
      <p class="text-[10px] font-mono text-fg-faint break-all">
        {{ agent.projectPath }}
      </p>
    </section>

    <!-- Activity -->
    <section class="flex flex-col gap-1.5">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Activity
      </h3>
      <p v-if="agent.currentAction" class="text-[12px] font-mono text-fg-soft truncate" :title="agent.currentAction">
        {{ agent.currentAction }}
      </p>
      <ul v-if="recentTools.length" class="flex flex-col gap-0.5">
        <li
          v-for="(t, i) in recentTools"
          :key="`${t.name}-${i}`"
          class="text-[10px] font-mono text-fg-faint truncate"
          :title="t.detail"
        >
          {{ t.name }}<span v-if="t.detail" class="text-fg-mute"> · {{ t.detail }}</span>
        </li>
      </ul>
      <p v-else-if="!agent.currentAction" class="text-[11px] text-fg-faint">
        No recorded tool activity yet.
      </p>
    </section>
  </aside>
</template>
