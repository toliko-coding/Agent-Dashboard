<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { useAgentServices } from '../composables/useAgentServices'

/*
 * A diagram of what this agent is actually connected to.
 *
 * Every node is backed by a field that exists, and a branch is omitted when
 * its data is absent — an agent with no subagents shows no subagent branch
 * rather than an empty box. Nothing here animates for decoration.
 *
 * The services branch is a genuine cross-system join: a listening port and this
 * agent resolve to the SAME workspace, so it really is "a server running in the
 * checkout this agent is editing". Workspace, not path containment — a linked
 * worktree shares a repository but is a different active workspace, and under
 * the old rule its server appeared on the main checkout's agent.
 */
const props = defineProps<{ agent: Agent }>()

// The same correlation the agent card uses — one rule, not two.
const { services: relatedServices } = useAgentServices(() => props.agent)

const taskCount = computed(() => props.agent.tasks.length)
const doneCount = computed(() => props.agent.tasks.filter(t => t.status === 'completed').length)
const subagentCount = computed(() => props.agent.subagents.length)

/*
 * Node kinds are visually distinct so the diagram reads as a system rather
 * than a row of identical boxes: what belongs to the agent's own work (tasks,
 * subagents), what is an attachable surface (terminal), and what is a real
 * process observed on the machine by LocalScope (service).
 */
type LeafKind = 'work' | 'surface' | 'service'

interface Leaf {
  id: string
  label: string
  sub: string
  kind: LeafKind
}

const LEAF_STYLE: Record<LeafKind, { stroke: string, fill: string, text: string }> = {
  work: { stroke: 'var(--line-strong)', fill: 'var(--card)', text: 'var(--fg-soft)' },
  surface: { stroke: 'var(--info-line)', fill: 'var(--info-soft)', text: 'var(--info-text)' },
  service: { stroke: 'var(--success-line)', fill: 'var(--success-soft)', text: 'var(--success-text)' },
}

/** Only branches with real backing data. */
const leaves = computed<Leaf[]>(() => {
  const out: Leaf[] = []
  if (taskCount.value > 0)
    out.push({ id: 'tasks', label: 'Tasks', sub: `${doneCount.value}/${taskCount.value} done`, kind: 'work' })
  if (subagentCount.value > 0)
    out.push({ id: 'subagents', label: 'Subagents', sub: `${subagentCount.value}`, kind: 'work' })
  if (props.agent.liveInjectable)
    out.push({ id: 'terminal', label: 'Terminal', sub: 'attachable', kind: 'surface' })
  if (props.agent.pipelineTaskId)
    out.push({ id: 'pipeline', label: 'Pipeline', sub: 'linked task', kind: 'work' })
  // Observed by LocalScope, not inferred here — a listening port resolved to
  // the same workspace as this agent really is a server in the checkout it edits.
  for (const s of relatedServices.value.slice(0, 2))
    out.push({ id: `svc-${s.id}`, label: s.label, sub: `:${s.port}`, kind: 'service' })
  return out
})

/** Which kinds are actually present, for the legend. */
const legend = computed(() => {
  const kinds = new Set(leaves.value.map(l => l.kind))
  return ([
    ['service', 'Local service'],
    ['surface', 'Attachable'],
    ['work', 'Agent work'],
  ] as [LeafKind, string][]).filter(([k]) => kinds.has(k))
})

const WIDTH = 300
const projectName = computed(() => props.agent.projectName)

/** Evenly spaces the leaves across the width, whatever their count. */
const positions = computed(() => {
  const n = leaves.value.length
  if (n === 0)
    return []
  const slot = WIDTH / n
  return leaves.value.map((leaf, i) => ({ leaf, cx: slot * i + slot / 2 }))
})
</script>

<template>
  <div class="overflow-x-auto" data-testid="agent-diagram">
    <svg
      :viewBox="`0 0 ${WIDTH} ${leaves.length ? 190 : 120}`"
      class="w-full h-auto"
      role="img"
      :aria-label="`${projectName} agent, working in ${agent.cwd}${leaves.length ? `, connected to ${leaves.map(l => l.label).join(', ')}` : ''}`"
    >
      <!-- Agent -->
      <g>
        <rect :x="WIDTH / 2 - 62" y="6" width="124" height="34" rx="8" fill="var(--accent-soft)" stroke="var(--accent)" />
        <text :x="WIDTH / 2" y="21" text-anchor="middle" fill="var(--accent)" font-size="11" font-weight="700">CLAUDE AGENT</text>
        <text :x="WIDTH / 2" y="33" text-anchor="middle" fill="var(--fg-mute)" font-size="9">{{ agent.model ?? 'model unknown' }}</text>
      </g>

      <line :x1="WIDTH / 2" y1="40" :x2="WIDTH / 2" y2="58" stroke="var(--accent)" stroke-width="1.5" opacity="0.7" />

      <!-- Project: always real — it is the process working directory -->
      <g>
        <rect :x="WIDTH / 2 - 78" y="58" width="156" height="34" rx="8" fill="var(--raised)" stroke="var(--line-strong)" />
        <text :x="WIDTH / 2" y="73" text-anchor="middle" fill="var(--fg)" font-size="11" font-weight="600">{{ projectName }}</text>
        <text :x="WIDTH / 2" y="85" text-anchor="middle" fill="var(--fg-faint)" font-size="8">working directory</text>
      </g>

      <template v-if="positions.length">
        <g fill="none" stroke="var(--line-strong)" stroke-width="1.5" opacity="0.6">
          <path
            v-for="p in positions"
            :key="`e-${p.leaf.id}`"
            :d="`M ${WIDTH / 2} 92 C ${WIDTH / 2} 118, ${p.cx} 118, ${p.cx} 140`"
          />
        </g>

        <g
          v-for="p in positions"
          :key="p.leaf.id"
          :data-testid="`diagram-leaf-${p.leaf.id}`"
          :data-kind="p.leaf.kind"
        >
          <title>{{ p.leaf.label }} — {{ p.leaf.sub }}</title>
          <rect
            :x="p.cx - 42" y="140" width="84" height="34" rx="7"
            :fill="LEAF_STYLE[p.leaf.kind].fill"
            :stroke="LEAF_STYLE[p.leaf.kind].stroke"
          />
          <text :x="p.cx" y="155" text-anchor="middle" :fill="LEAF_STYLE[p.leaf.kind].text" font-size="9.5" font-weight="600">
            {{ p.leaf.label.length > 13 ? `${p.leaf.label.slice(0, 12)}…` : p.leaf.label }}
          </text>
          <text :x="p.cx" y="166" text-anchor="middle" fill="var(--fg-faint)" font-size="8">{{ p.leaf.sub }}</text>
        </g>
      </template>
    </svg>

    <!-- Legend lists only the kinds actually drawn, so it never advertises a
         node type this agent has no data for. -->
    <ul v-if="legend.length" class="flex flex-wrap gap-x-3 gap-y-1 mt-1" data-testid="diagram-legend">
      <li v-for="[kind, label] in legend" :key="kind" class="flex items-center gap-1 text-[9px] text-fg-faint">
        <span
          class="size-2 rounded-sm shrink-0 border"
          :style="{ backgroundColor: LEAF_STYLE[kind].fill, borderColor: LEAF_STYLE[kind].stroke }"
          aria-hidden="true"
        />
        {{ label }}
      </li>
    </ul>
  </div>
</template>
