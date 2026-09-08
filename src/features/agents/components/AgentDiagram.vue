<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { useLocalScopeServices } from '@/features/localscope'
import { isPathUnder } from '@/utils/projectAgents'

/*
 * A diagram of what this agent is actually connected to.
 *
 * Every node is backed by a field that exists, and a branch is omitted when
 * its data is absent — an agent with no subagents shows no subagent branch
 * rather than an empty box. Nothing here animates for decoration.
 *
 * The services branch is a genuine cross-system join: LocalScope reports
 * listening ports with the project directory they run in, so a port whose cwd
 * sits inside this agent's working directory really is "a server running in
 * the project this agent is editing".
 */
const props = defineProps<{ agent: Agent }>()

const services = useLocalScopeServices()

/** Listening ports LocalScope found inside this agent's working directory. */
const relatedServices = computed(() => {
  const list = services.data.value ?? []
  return list.filter((s) => {
    const root = s.project?.rootPath ?? s.cwd
    return root ? isPathUnder(root, props.agent.cwd) || isPathUnder(props.agent.cwd, root) : false
  })
})

const taskCount = computed(() => props.agent.tasks.length)
const doneCount = computed(() => props.agent.tasks.filter(t => t.status === 'completed').length)
const subagentCount = computed(() => props.agent.subagents.length)

interface Leaf {
  id: string
  label: string
  sub: string
}

/** Only branches with real backing data. */
const leaves = computed<Leaf[]>(() => {
  const out: Leaf[] = []
  if (taskCount.value > 0)
    out.push({ id: 'tasks', label: 'Tasks', sub: `${doneCount.value}/${taskCount.value} done` })
  if (subagentCount.value > 0)
    out.push({ id: 'subagents', label: 'Subagents', sub: `${subagentCount.value}` })
  if (props.agent.liveInjectable)
    out.push({ id: 'terminal', label: 'Terminal', sub: 'attachable' })
  if (props.agent.pipelineTaskId)
    out.push({ id: 'pipeline', label: 'Pipeline', sub: 'linked task' })
  for (const s of relatedServices.value.slice(0, 2))
    out.push({ id: `svc-${s.id}`, label: s.label, sub: `:${s.port}` })
  return out
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

        <g v-for="p in positions" :key="p.leaf.id" :data-testid="`diagram-leaf-${p.leaf.id}`">
          <rect :x="p.cx - 42" y="140" width="84" height="34" rx="7" fill="var(--card)" stroke="var(--line)" />
          <text :x="p.cx" y="155" text-anchor="middle" fill="var(--fg-soft)" font-size="9.5" font-weight="600">
            {{ p.leaf.label.length > 13 ? `${p.leaf.label.slice(0, 12)}…` : p.leaf.label }}
          </text>
          <text :x="p.cx" y="166" text-anchor="middle" fill="var(--fg-faint)" font-size="8">{{ p.leaf.sub }}</text>
        </g>
      </template>
    </svg>
  </div>
</template>
