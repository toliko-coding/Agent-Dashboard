<script setup lang="ts">
/*
 * Command's identity band (3N.2): the page title and one line of what it is,
 * with a technical network motif beside it.
 *
 * The motif is decoration drawn once in SVG and says nothing about data, with
 * one exception that is true: while agent updates are live, a dash travels
 * along its links — the same "data is flowing" vocabulary as elsewhere — and
 * it stops when updates stop. Reduced motion stops it too. No invented
 * numbers, graphs or status here.
 */
defineProps<{
  /** Agent updates are arriving. */
  live: boolean
}>()

const NODES: [number, number, number][] = [
  [40, 70, 3],
  [110, 32, 2.5],
  [150, 88, 3.5],
  [220, 50, 2.5],
  [260, 96, 2.5],
  [320, 36, 3],
  [370, 78, 2.5],
  [430, 52, 3.5],
  [480, 94, 2.5],
  [520, 30, 2.5],
]
const LINKS: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 6], [5, 6], [5, 7], [6, 8], [7, 8], [7, 9]]
</script>

<template>
  <section
    class="cc-hero relative overflow-hidden rounded-xl border border-line px-6 py-5"
    aria-labelledby="command-hero-title"
    data-testid="command-hero"
  >
    <svg
      class="pointer-events-none absolute inset-y-0 right-0 h-full w-[min(560px,60%)] text-accent"
      viewBox="0 0 560 128"
      preserveAspectRatio="xMaxYMid slice"
      aria-hidden="true"
      focusable="false"
      data-testid="command-hero-motif"
    >
      <g fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1">
        <line
          v-for="([a, b], i) in LINKS"
          :key="i"
          :x1="NODES[a][0]"
          :y1="NODES[a][1]"
          :x2="NODES[b][0]"
          :y2="NODES[b][1]"
        />
      </g>
      <g v-if="live" fill="none" stroke="var(--color-live-dot)" stroke-opacity="0.7" stroke-width="1.2" stroke-dasharray="3 14" data-testid="command-hero-flow">
        <line
          v-for="([a, b], i) in LINKS"
          :key="`f${i}`"
          class="motion-flow"
          :style="{ '--flow-dash': 17 }"
          :x1="NODES[a][0]"
          :y1="NODES[a][1]"
          :x2="NODES[b][0]"
          :y2="NODES[b][1]"
        />
      </g>
      <g fill="currentColor">
        <circle v-for="([x, y, r], i) in NODES" :key="`n${i}`" :cx="x" :cy="y" :r="r" fill-opacity="0.55" />
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
