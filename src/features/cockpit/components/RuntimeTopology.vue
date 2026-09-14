<script setup lang="ts">
import type { Agent } from '@/types'
import { ref, watch } from 'vue'
import RuntimeTopologyTree from './RuntimeTopologyTree.vue'

/*
 * The runtime identity graph, beneath Command's Runtime summary. The Runtime
 * page shows the same tree, always open, as its Workspaces section.
 *
 * Added beside the existing diagram rather than replacing it. That diagram is a
 * hand-placed, fixed-size SVG of machine-level counts; it cannot hold a variable
 * number of repositories and workspaces without being rewritten, and a wide
 * graph of them would need exactly the horizontal scrolling a laptop-width panel
 * cannot afford. Nested lists grow vertically instead, and give assistive
 * technology the hierarchy for free.
 *
 * The service and process lists are only polled while this is expanded: the
 * tree is unmounted when collapsed, and the list resources stop on their last
 * consumer. Those lists were deliberately kept off always-mounted surfaces, and
 * a collapsed section must not quietly bring them back.
 */
defineProps<{ agents: Agent[] }>()

const STORAGE_KEY = 'system-map-topology-expanded'

/*
 * Collapsed unless the user has explicitly expanded it.
 *
 * Expanding mounts the tree, and the tree is what starts the normalized service
 * and process list pollers. Those lists were deliberately kept off always-open
 * surfaces, and the Overview is the landing page — so a first visit must not
 * start them. Only a stored "true" opens the section; a missing or unreadable
 * preference leaves it closed.
 *
 * Nothing is written on startup. The preference is persisted only when the user
 * toggles, so reading a stored choice can never overwrite it.
 */
function readExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  }
  catch {
    return false
  }
}

const expanded = ref(readExpanded())
watch(expanded, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  }
  catch { /* storage unavailable: the section still works, it just won't remember */ }
})
</script>

<template>
  <section class="flex flex-col gap-2 border-t border-line pt-3 min-w-0" data-testid="runtime-topology">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h3 class="text-ui font-semibold text-fg">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded focus-visible:outline-2 focus-visible:outline-ring"
          :aria-expanded="expanded"
          :aria-controls="expanded ? 'runtime-topology-tree' : undefined"
          data-testid="runtime-topology-toggle"
          @click="expanded = !expanded"
        >
          <span class="text-fg-soft text-label w-3 inline-block" aria-hidden="true">{{ expanded ? '▼' : '▶' }}</span>
          Runtime topology
        </button>
      </h3>
      <span class="text-ui-sm text-fg-faint">Repository → workspace → agents, processes and services</span>
    </div>
    <RuntimeTopologyTree v-if="expanded" id="runtime-topology-tree" :agents="agents" />
  </section>
</template>
