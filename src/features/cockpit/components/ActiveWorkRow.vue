<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import AgentGlyph from '@/components/ui/AgentGlyph.vue'
import { useNow } from '@/composables/useNow'
import { agentSessionLabel, agentTitle, workActivity } from '@/utils/agentLabels'
import { formatRelativeActivity, formatUptime, secondsSince, shortModel } from '@/utils/format'

/*
 * One working agent as an operational row: state, category and name, what it
 * is doing, the few facts that identify it, and how recently it moved.
 *
 * Deliberately absent: PID, cwd or any path, the transcript, and a tool call's
 * arguments. The row opens the agent's details, where those live.
 *
 * The state dot moves only while the evidence is live: a slow breath while the
 * agent works, a blip while a tool call is open. A last-known row (agent
 * updates reconnecting) is still, because nothing currently says it is working.
 *
 * "up" is how long the agent's process has been running — a measured fact, not
 * how long the current turn has taken, which the payload does not carry.
 */
const props = defineProps<{ agent: Agent, stale?: boolean }>()
const emit = defineEmits<{ select: [agent: Agent] }>()

// The shared 30s clock; one interval for every row on the page.
const { nowMs } = useNow()

const activity = computed(() => workActivity(props.agent))
const title = computed(() => agentTitle(props.agent))
const handle = computed(() => {
  const label = agentSessionLabel(props.agent)
  return label === title.value ? null : label
})
const since = computed(() => formatRelativeActivity(secondsSince(props.agent.lastActivity, nowMs.value)))

const facts = computed(() => {
  const list: string[] = []
  if (props.agent.model)
    list.push(shortModel(props.agent.model))
  if (props.agent.spawnerName)
    list.push(props.agent.spawnerName)
  const subagents = (props.agent.subagents ?? []).filter(s => s.status === 'active').length
  if (subagents > 0)
    list.push(`${subagents} ${subagents === 1 ? 'subagent' : 'subagents'}`)
  if (Number.isFinite(props.agent.uptime) && props.agent.uptime > 0)
    list.push(`up ${formatUptime(props.agent.uptime)}`)
  return list
})

const STATE = {
  working: { word: 'Working', dot: 'bg-state-working', motion: 'motion-working', text: 'text-state-working' },
  tool: { word: 'Tool', dot: 'bg-state-tool', motion: 'motion-tool', text: 'text-state-tool' },
} as const
const state = computed(() => STATE[activity.value.state])

const accessibleName = computed(() =>
  [title.value, activity.value.label, ...facts.value, `last activity ${since.value}`].join(', '))
</script>

<template>
  <button
    type="button"
    data-testid="active-work-agent"
    :data-state="activity.state"
    :aria-label="accessibleName"
    class="w-full min-w-0 grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-control px-2.5 py-2 text-left cursor-pointer hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card"
    @click="emit('select', agent)"
  >
    <span class="flex items-center gap-1.5 min-w-0">
      <span
        class="size-2 rounded-full shrink-0"
        :class="[state.dot, stale ? '' : state.motion]"
        data-testid="active-work-dot"
        aria-hidden="true"
      />
      <span class="text-ui-sm font-medium" :class="state.text">{{ state.word }}</span>
    </span>
    <span class="flex min-w-0 items-center gap-2.5">
      <AgentGlyph :agent="agent" size="sm" />
      <span class="min-w-0 flex flex-col gap-0.5">
        <span class="flex flex-wrap items-baseline gap-x-2 min-w-0">
          <span class="text-ui font-semibold text-fg truncate max-w-full" data-testid="active-work-title">{{ title }}</span>
          <span v-if="activity.state === 'tool'" class="text-ui font-medium text-state-tool truncate max-w-full" data-testid="active-work-activity">{{ activity.label }}</span>
        </span>
        <span v-if="facts.length || handle" class="flex min-w-0 items-baseline gap-2 text-ui-sm text-fg-mute">
          <span v-if="facts.length" class="truncate" data-testid="active-work-facts">{{ facts.join(' · ') }}</span>
          <span v-if="handle" class="shrink-0 truncate font-mono text-label text-fg-faint" data-testid="active-work-handle">{{ handle }}</span>
        </span>
      </span>
    </span>
    <span class="text-ui-sm text-fg-mute tabular-nums whitespace-nowrap" data-testid="active-work-since">{{ since }}</span>
  </button>
</template>
