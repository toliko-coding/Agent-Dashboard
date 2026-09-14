<script setup lang="ts">
import type { RuntimeSection } from '@/utils/runtimeSections'
import { useRuntimeSection } from '@/composables/useRuntimeSection'
import { RUNTIME_SECTIONS } from '@/utils/runtimeSections'
import RuntimeDevices from './RuntimeDevices.vue'
import RuntimeOverview from './RuntimeOverview.vue'
import RuntimeProcesses from './RuntimeProcesses.vue'
import RuntimeServices from './RuntimeServices.vue'
import RuntimeSourceStatus from './RuntimeSourceStatus.vue'
import RuntimeWorkspaces from './RuntimeWorkspaces.vue'

/*
 * Runtime: this machine, as one page.
 *
 * Replaces the LocalScope and System views (3K). The topbar carries the page's
 * h1 ("Runtime") and the open section; each section brings its own h2.
 *
 * Polling follows the open section, and nothing else:
 *
 *   always      the shared snapshot (source status, Overview counts)
 *   Overview    + /api/system, which the sidebar machine card already polls
 *   Workspaces  + the service and process lists (the topology)
 *   Services    + the service list
 *   Processes   + the process list; the all-processes scan only when asked
 *   Devices     + the device list
 *
 * Sections are rendered with v-if, so a list resource starts when its section
 * mounts and stops when it unmounts. Every resource is a shared, ref-counted
 * singleton, so a list open here and on Command's expanded topology is still
 * one poller.
 */
const { activeSection } = useRuntimeSection()

function select(section: RuntimeSection): void {
  activeSection.value = section
}

// Arrow keys move between sections, Home and End jump to the ends; Enter or Space opens one.
function onNavKeydown(event: KeyboardEvent): void {
  const buttons = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index === -1)
    return
  let next: number | null = null
  if (event.key === 'ArrowRight')
    next = (index + 1) % buttons.length
  else if (event.key === 'ArrowLeft')
    next = (index - 1 + buttons.length) % buttons.length
  else if (event.key === 'Home')
    next = 0
  else if (event.key === 'End')
    next = buttons.length - 1
  if (next === null)
    return
  event.preventDefault()
  buttons[next].focus()
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4" data-testid="runtime-page">
    <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <!-- Scrolls inside itself on a narrow window, never the page. -->
      <nav aria-label="Runtime sections" data-testid="runtime-nav" class="min-w-0 max-w-full overflow-x-auto">
        <ul
          class="m-0 flex w-max list-none items-center gap-0.5 rounded-panel border border-line bg-card p-1"
          @keydown="onNavKeydown"
        >
          <li v-for="s in RUNTIME_SECTIONS" :key="s.id">
            <button
              type="button"
              :data-testid="`runtime-nav-${s.id}`"
              class="cursor-pointer rounded-control border-none px-3 py-1.5 text-ui transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
              :class="activeSection === s.id
                ? 'bg-accent-soft font-semibold text-accent'
                : 'bg-transparent text-fg-mute hover:bg-raised hover:text-fg'"
              :aria-current="activeSection === s.id ? 'page' : undefined"
              @click="select(s.id)"
            >
              {{ s.label }}
            </button>
          </li>
        </ul>
      </nav>
      <RuntimeSourceStatus class="ml-auto" />
    </div>

    <div class="min-w-0" data-testid="runtime-content" :data-section="activeSection">
      <RuntimeOverview v-if="activeSection === 'overview'" @open-section="select" />
      <RuntimeWorkspaces v-else-if="activeSection === 'workspaces'" />
      <RuntimeServices v-else-if="activeSection === 'services'" />
      <RuntimeProcesses v-else-if="activeSection === 'processes'" />
      <RuntimeDevices v-else-if="activeSection === 'devices'" />
    </div>
  </div>
</template>
