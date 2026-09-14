<script setup lang="ts">
import type { SnapshotSource } from '@/features/localscope'
import { computed, onMounted, onUnmounted, ref } from 'vue'

/*
 * Command's identity band (3N.2.3): the page title, one line of what it is,
 * and a small command network drawn from what the dashboard actually knows.
 *
 * The network is fixed — five nodes for the parts of the product, never one
 * per agent, service or item, so it cannot pretend to be data it is not:
 *
 *   Dashboard ─┬─ Agents ──────── Needs you
 *              │        ╲
 *              │         Workspaces
 *              │        ╱
 *              └─ Runtime
 *
 * What changes is state, and each change is a real one:
 *   agent updates live     a slow signal from Dashboard to Agents
 *   reconnecting           every signal stops and the network dims
 *   an agent is working    Agents and Workspaces light, and a signal runs to Workspaces
 *   something needs you    Needs you turns amber, with a slow, quiet halo
 *   LocalScope ok/degraded a signal to Runtime
 *   LocalScope stale/down  the Runtime branch dims and goes dashed; no signal
 *   unknown (not observed) the node stays dim, never shown as zero
 *
 * Motion is stroke-dashoffset and opacity on a handful of paths, no timers.
 * It stops while the tab is hidden and is not drawn at all under reduced
 * motion. The network is aria-hidden: the status strip below says the same
 * things in words.
 */
type NodeState = 'idle' | 'active' | 'attention' | 'dim'

const props = defineProps<{
  /** Agent updates are arriving. */
  live: boolean
  /** Working agents; null before any agent observation. */
  working?: number | null
  /** Needs you items; null while the queue is loading or unavailable. */
  needsYou?: number | null
  /** LocalScope's snapshot source; null before it has been read. */
  runtime?: SnapshotSource | null
}>()

const NODES = {
  dashboard: { x: 64, y: 70, label: 'Dashboard', labelY: 96 },
  agents: { x: 196, y: 36, label: 'Agents', labelY: 20 },
  runtime: { x: 196, y: 104, label: 'Runtime', labelY: 126 },
  workspaces: { x: 328, y: 70, label: 'Workspaces', labelY: 96 },
  needs: { x: 440, y: 36, label: 'Needs you', labelY: 20 },
} as const

const PATHS = {
  agents: 'M64 70 H112 L146 36 H196',
  runtime: 'M64 70 H112 L146 104 H196',
  agentsWorkspaces: 'M196 36 H250 L284 70 H328',
  runtimeWorkspaces: 'M196 104 H250 L284 70 H328',
  needs: 'M196 36 H440',
} as const

const reducedMotion = ref(false)
const hidden = ref(false)
let motionQuery: MediaQueryList | null = null
function onMotionChange(e: MediaQueryListEvent) {
  reducedMotion.value = e.matches
}
function onVisibility() {
  hidden.value = document.visibilityState === 'hidden'
}
onMounted(() => {
  motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  reducedMotion.value = motionQuery?.matches ?? false
  motionQuery?.addEventListener?.('change', onMotionChange)
  document.addEventListener('visibilitychange', onVisibility)
  onVisibility()
})
onUnmounted(() => {
  motionQuery?.removeEventListener?.('change', onMotionChange)
  document.removeEventListener('visibilitychange', onVisibility)
})

const working = computed(() => props.working ?? null)
const needsYou = computed(() => props.needsYou ?? null)
const runtimeFresh = computed(() => props.runtime === 'ok' || props.runtime === 'degraded')

const states = computed<Record<keyof typeof NODES, NodeState>>(() => ({
  dashboard: props.live ? 'active' : 'attention',
  agents: working.value === null ? 'dim' : working.value > 0 ? 'active' : 'idle',
  runtime: runtimeFresh.value ? 'idle' : 'dim',
  workspaces: working.value !== null && working.value > 0 ? 'active' : 'idle',
  needs: needsYou.value === null ? 'dim' : needsYou.value > 0 ? 'attention' : 'idle',
}))

const animate = computed(() => props.live && !reducedMotion.value)
const signals = computed(() => {
  if (!animate.value)
    return []
  const out: { key: string, d: string, duration: string, delay: string }[] = [
    { key: 'agents', d: PATHS.agents, duration: '7.5s', delay: '0s' },
  ]
  if (runtimeFresh.value)
    out.push({ key: 'runtime', d: PATHS.runtime, duration: '7.5s', delay: '3.75s' })
  if (working.value !== null && working.value > 0)
    out.push({ key: 'workspaces', d: PATHS.agentsWorkspaces, duration: '4.5s', delay: '1.2s' })
  return out
})

const nodeList = computed(() => (Object.keys(NODES) as (keyof typeof NODES)[]).map(key => ({ key, ...NODES[key], state: states.value[key] })))
</script>

<template>
  <section
    class="cc-hero relative overflow-hidden rounded-xl border border-line px-6 py-5"
    aria-labelledby="command-hero-title"
    data-testid="command-hero"
  >
    <svg
      class="cc-net pointer-events-none absolute inset-y-0 right-4 hidden h-full w-[min(470px,46%)] xl:block"
      viewBox="0 0 480 136"
      preserveAspectRatio="xMaxYMid meet"
      aria-hidden="true"
      focusable="false"
      data-testid="command-hero-motif"
      :data-live="live ? 'true' : 'false'"
      :data-paused="hidden ? 'true' : undefined"
      :data-working="working === null ? 'unknown' : String(working > 0)"
      :data-needs-you="needsYou === null ? 'unknown' : String(needsYou > 0)"
      :data-runtime="runtime ?? 'unknown'"
    >
      <g class="cc-net-links">
        <path class="cc-net-line" :d="PATHS.agents" />
        <path class="cc-net-line" :d="PATHS.agentsWorkspaces" />
        <path class="cc-net-line" :d="PATHS.needs" />
        <path class="cc-net-line" :d="PATHS.runtime" :data-dim="runtimeFresh ? undefined : 'true'" data-testid="command-hero-runtime-link" />
        <path class="cc-net-line" :d="PATHS.runtimeWorkspaces" :data-dim="runtimeFresh ? undefined : 'true'" />
      </g>
      <g data-testid="command-hero-flow">
        <path
          v-for="s in signals"
          :key="s.key"
          class="cc-net-signal"
          :d="s.d"
          pathLength="100"
          :style="{ animationDuration: s.duration, animationDelay: s.delay }"
          :data-signal="s.key"
        />
      </g>
      <g>
        <circle class="cc-net-orbit" :cx="NODES.dashboard.x" :cy="NODES.dashboard.y" r="15" />
        <g v-for="n in nodeList" :key="n.key" class="cc-net-node" :data-node="n.key" :data-state="n.state">
          <circle v-if="n.state === 'attention' && n.key === 'needs' && animate" class="cc-net-halo" :cx="n.x" :cy="n.y" r="9" />
          <circle class="cc-net-ring" :cx="n.x" :cy="n.y" :r="n.key === 'dashboard' ? 8 : 6" />
          <circle class="cc-net-core" :cx="n.x" :cy="n.y" :r="n.key === 'dashboard' ? 2.8 : 2.2" />
          <text class="cc-net-label" :x="n.x" :y="n.labelY" text-anchor="middle">{{ n.label }}</text>
        </g>
      </g>
    </svg>

    <div class="relative flex max-w-[34rem] flex-col gap-1">
      <h2 id="command-hero-title" class="m-0 text-[28px] font-semibold leading-tight tracking-tight text-fg">
        Command <span class="cc-accent-text">Center</span>
      </h2>
      <p class="m-0 text-body text-fg-soft">
        Your AI agents. One control center.
      </p>
      <p class="m-0 mt-1 flex items-center gap-1.5 text-ui-sm" data-testid="command-hero-live">
        <span class="size-1.5 rounded-full" :class="live ? 'bg-state-live' : 'bg-warning'" aria-hidden="true" />
        <span :class="live ? 'text-live-text' : 'text-warning-text'">{{ live ? 'Agent updates live' : 'Agent updates reconnecting' }}</span>
      </p>
    </div>
  </section>
</template>
