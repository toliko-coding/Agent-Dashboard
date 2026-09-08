<script setup lang="ts">
import { computed } from 'vue'
import { useProjects } from '@/composables/useProjects'
import { useSystemResources } from '@/composables/useSystemResources'
import { useAgents } from '@/features/agents'
import CockpitPanel from './CockpitPanel.vue'

/*
 * A fixed topology diagram, drawn as plain inline SVG.
 *
 * d3 is a dependency of this project, but nothing here needs it: the layout is
 * a hand-placed, unchanging tree of seven nodes. A force simulation would make
 * a known shape jitter into a different arrangement on every mount, which is
 * strictly worse for a diagram whose whole job is to be recognisable.
 *
 * Counts come from the shared singletons already streaming; the three
 * right-hand nodes have no collector and are drawn as unavailable rather than
 * as empty, so the map shows the shape of what is NOT wired up yet.
 */
const emit = defineEmits<{ navigate: [view: 'dashboard' | 'projects' | 'localscope'] }>()

const { agents } = useAgents({ autoStart: false })
const { projects } = useProjects()
const resources = useSystemResources()

const machineLabel = computed(() => resources.info.value?.cpu.model?.trim() || 'Local machine')

interface MapNode {
  id: string
  label: string
  sub: string
  available: boolean
  x: number
  y: number
  view?: 'dashboard' | 'projects' | 'localscope'
}

const sources = computed<MapNode[]>(() => [
  {
    id: 'agents',
    label: 'Agents',
    sub: `${agents.value.length} running`,
    available: true,
    x: 12,
    y: 22,
    view: 'dashboard',
  },
  {
    id: 'projects',
    label: 'Projects',
    sub: `${projects.value.length} registered`,
    available: true,
    x: 12,
    y: 90,
    view: 'projects',
  },
  {
    id: 'localscope',
    label: 'LocalScope',
    sub: 'Not connected',
    available: false,
    x: 12,
    y: 158,
    view: 'localscope',
  },
])

const outputs = computed<MapNode[]>(() => [
  { id: 'services', label: 'Local Services', sub: 'Not collected', available: false, x: 400, y: 22 },
  { id: 'emulators', label: 'Emulators', sub: 'Not collected', available: false, x: 400, y: 90 },
  { id: 'network', label: 'Network', sub: 'Not collected', available: false, x: 400, y: 158 },
])

const NODE_W = 150
const NODE_H = 46
const HUB = { x: 214, y: 90, w: 160, h: 46 }

/** Cubic curve from a node's right edge to the hub's left edge (and onward). */
function curveTo(from: { x: number, y: number }, to: { x: number, y: number, w?: number }): string {
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

function curveFromHub(to: { x: number, y: number }): string {
  const x1 = HUB.x + HUB.w
  const y1 = HUB.y + HUB.h / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}
</script>

<template>
  <CockpitPanel id="systemmap" title="System Map" state="ready">
    <!-- Scrolls inside its own box rather than pushing the page wide. -->
    <div class="overflow-x-auto" data-testid="system-map">
      <svg
        viewBox="0 0 550 226"
        class="w-full min-w-[520px] h-auto"
        role="img"
        aria-label="Topology: agents, projects and LocalScope connect to the local machine, which would expose local services, emulators and network once a collector exists."
      >
        <g fill="none" stroke-width="1.5">
          <path
            v-for="n in sources"
            :key="`edge-${n.id}`"
            :d="curveTo(n, HUB)"
            :stroke="n.available ? 'var(--accent)' : 'var(--line-strong)'"
            :stroke-dasharray="n.available ? undefined : '4 4'"
            :opacity="n.available ? 0.75 : 0.5"
          />
          <path
            v-for="n in outputs"
            :key="`edge-out-${n.id}`"
            :d="curveFromHub(n)"
            stroke="var(--line-strong)"
            stroke-dasharray="4 4"
            :opacity="0.5"
          />
        </g>

        <!-- Hub -->
        <g>
          <rect
            :x="HUB.x" :y="HUB.y" :width="HUB.w" :height="HUB.h" rx="8"
            fill="var(--raised)" stroke="var(--accent)" stroke-width="1.5"
          />
          <text :x="HUB.x + 12" :y="HUB.y + 20" fill="var(--fg)" font-size="12" font-weight="600">Local Machine</text>
          <text :x="HUB.x + 12" :y="HUB.y + 35" fill="var(--fg-mute)" font-size="10">{{ machineLabel }}</text>
        </g>

        <!-- Sources: real, and clickable through to their view -->
        <g
          v-for="n in sources"
          :key="n.id"
          :class="n.view ? 'cursor-pointer' : ''"
          :tabindex="n.view ? 0 : undefined"
          :role="n.view ? 'button' : undefined"
          :aria-label="n.view ? `${n.label}: ${n.sub}. Open ${n.label}` : undefined"
          :data-testid="`map-node-${n.id}`"
          :data-available="n.available"
          @click="n.view && emit('navigate', n.view)"
          @keydown.enter="n.view && emit('navigate', n.view)"
          @keydown.space.prevent="n.view && emit('navigate', n.view)"
        >
          <rect
            :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="8"
            fill="var(--card)"
            :stroke="n.available ? 'var(--line-strong)' : 'var(--line)'"
            :stroke-dasharray="n.available ? undefined : '4 4'"
          />
          <text :x="n.x + 12" :y="n.y + 20" :fill="n.available ? 'var(--fg)' : 'var(--fg-faint)'" font-size="12" font-weight="600">{{ n.label }}</text>
          <text :x="n.x + 12" :y="n.y + 35" fill="var(--fg-faint)" font-size="10">{{ n.sub }}</text>
        </g>

        <!-- Outputs: no collector yet -->
        <g v-for="n in outputs" :key="n.id" :data-testid="`map-node-${n.id}`" :data-available="n.available">
          <rect
            :x="n.x" :y="n.y" :width="NODE_W" :height="NODE_H" rx="8"
            fill="var(--card)" stroke="var(--line)" stroke-dasharray="4 4"
          />
          <text :x="n.x + 12" :y="n.y + 20" fill="var(--fg-faint)" font-size="12" font-weight="600">{{ n.label }}</text>
          <text :x="n.x + 12" :y="n.y + 35" fill="var(--fg-faint)" font-size="10">{{ n.sub }}</text>
        </g>
      </svg>
    </div>

    <p class="text-[10px] text-fg-faint mt-1">
      Dashed outline = no collector yet
    </p>
  </CockpitPanel>
</template>
