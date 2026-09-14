<script setup lang="ts">
import type { ActiveView } from '../../composables/useViewState'
import { computed } from 'vue'
import { useSidebar } from '../../composables/useSidebar'
import { useViewState } from '../../composables/useViewState'
import { navSections } from '../../utils/navConfig'
import MachineCard from './MachineCard.vue'
import NavItem from './NavItem.vue'
import SidebarFooter from './SidebarFooter.vue'

const props = defineProps<{
  agentCount: number
  attentionCount: number
  /** Working agents (Command's Active work count); null before agents are observed. */
  workingCount?: number | null
  taskCount: number
  live: boolean
  theme: 'dark' | 'light'
  canInstall: boolean
}>()
const emit = defineEmits<{
  openSessions: []
  toggleTheme: []
  install: []
}>()

const { expanded, pinned, togglePinned, setHovering, setFocused, collapseAfterSelect } = useSidebar()
const { activeView } = useViewState()

/*
 * Destinations in order. A destination of several views gets a caption; a break
 * separates any destination that is, or follows, such a group, so a single
 * entry (Projects) never reads as the last item of the group above it.
 */
const grouped = computed(() => navSections().map((section, index, all) => ({
  ...section,
  caption: section.items.length > 1 ? section.group : null,
  breakBefore: index > 0 && (section.items.length > 1 || all[index - 1].items.length > 1),
})))

function badgeFor(view: ActiveView): number | null {
  if (view === 'dashboard')
    return props.attentionCount > 0 ? props.attentionCount : props.agentCount
  if (view === 'pipeline')
    return props.taskCount
  return null
}

function badgeDanger(view: ActiveView): boolean {
  return view === 'dashboard' && props.attentionCount > 0
}

// Unpinned expansion floats above the content instead of widening the rail, so
// hovering the nav never reflows the page behind it.
const floating = computed(() => expanded.value && !pinned.value)

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (!next || !(event.currentTarget as HTMLElement).contains(next))
    setFocused(false)
}

function selectView(view: ActiveView): void {
  activeView.value = view
  collapseAfterSelect()
}
</script>

<template>
  <div
    class="relative shrink-0 h-full transition-[width] duration-200 motion-reduce:transition-none"
    :class="pinned ? 'w-[220px]' : 'w-[56px]'"
    data-testid="sidebar-rail"
  >
    <nav
      aria-label="Primary"
      class="absolute inset-y-0 left-0 z-30 bg-card border-r border-line flex flex-col py-3 transition-[width] duration-200 motion-reduce:transition-none"
      :class="[
        expanded ? 'w-[220px] px-2' : 'w-[56px] px-1.5',
        floating ? 'shadow-[4px_0_16px_rgba(0,0,0,0.18)]' : '',
      ]"
      @mouseenter="setHovering(true)"
      @mouseleave="setHovering(false)"
      @focusin="setFocused(true)"
      @focusout="onFocusOut"
    >
      <div class="flex items-center gap-2 px-1.5 pb-3 mb-2 border-b border-line">
        <div class="w-7 h-7 rounded-lg bg-accent shrink-0" aria-hidden="true" />
        <div v-if="expanded" class="min-w-0 flex flex-col">
          <span class="text-[13px] font-semibold text-fg truncate leading-tight">Agent Dashboard</span>
          <!--
            Says only what `live` measures. App.vue derives it from the agents
            feed (useAgents: the last SSE frame or GET /api/agents succeeded),
            so it can vouch for agent updates arriving and nothing else — not
            agent, service or machine health, and not LocalScope, which has its
            own freshness indicators. It used to read "all systems normal".
          -->
          <span class="flex items-center gap-1 text-[10px] text-fg-faint" role="status" data-testid="sidebar-live-status">
            <span
              class="w-1.5 h-1.5 rounded-full shrink-0"
              :class="live ? 'bg-live-dot' : 'bg-warning'"
              aria-hidden="true"
            />
            {{ live ? 'Agent updates live' : 'Reconnecting…' }}
          </span>
          <!--
            The environment in one line: the same working count as Command's
            Active work and the same Needs you queue as the badge. No LocalScope
            freshness here — the sidebar is on every page, and reading the
            snapshot would start its poller everywhere.
          -->
          <span
            v-if="workingCount !== null && workingCount !== undefined"
            class="text-[11px] text-fg-faint tabular-nums truncate"
            data-testid="sidebar-environment"
          >{{ workingCount }} working · {{ attentionCount }} {{ attentionCount === 1 ? 'needs' : 'need' }} you</span>
        </div>
        <button
          type="button"
          data-testid="sidebar-pin"
          class="ml-auto text-fg-faint hover:text-fg text-[14px] rounded px-1 min-h-[28px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          :aria-expanded="pinned"
          :aria-label="pinned ? 'Unpin sidebar' : 'Pin sidebar open'"
          @click="togglePinned"
        >
          <span aria-hidden="true">{{ pinned ? '«' : '»' }}</span>
        </button>
      </div>

      <div class="flex-1 flex flex-col gap-0.5 overflow-y-auto">
        <div
          v-for="g in grouped"
          :key="g.group"
          class="flex flex-col gap-0.5"
          :data-testid="`nav-section-${g.group.toLowerCase()}`"
        >
          <div v-if="expanded && g.caption" class="px-2 pt-3 pb-1 text-[9px] uppercase tracking-wider text-fg-faint font-bold">
            {{ g.caption }}
          </div>
          <div
            v-else-if="g.breakBefore"
            aria-hidden="true"
            data-testid="nav-group-divider"
            class="h-px bg-line self-center my-2"
            :class="expanded ? 'w-[calc(100%-1rem)]' : 'w-6'"
          />
          <NavItem
            v-for="item in g.items"
            :key="item.view"
            :icon="item.icon"
            :label="item.label"
            :active="activeView === item.view"
            :expanded="expanded"
            @select="selectView(item.view)"
          >
            <template v-if="badgeFor(item.view) !== null" #badge>
              <span
                class="text-[9px] rounded-full px-1.5 py-0.5"
                :class="badgeDanger(item.view)
                  ? 'bg-red-500 text-white font-bold'
                  : 'bg-raised text-fg-mute'"
              >{{ badgeFor(item.view) }}</span>
            </template>
          </NavItem>
        </div>

        <!--
          Settings, the last destination: a page like the others, rendered here
          as the trailing entry rather than as a NAV_ITEMS group of its own.
        -->
        <div class="flex flex-col gap-0.5" data-testid="nav-section-settings">
          <div
            aria-hidden="true"
            data-testid="nav-group-divider"
            class="h-px bg-line self-center my-2"
            :class="expanded ? 'w-[calc(100%-1rem)]' : 'w-6'"
          />
          <NavItem
            icon="⚙"
            label="Settings"
            data-testid="nav-settings"
            :active="activeView === 'settings'"
            :expanded="expanded"
            @select="selectView('settings')"
          />
        </div>
      </div>

      <MachineCard :expanded="expanded" />

      <SidebarFooter
        :expanded="expanded"
        :theme="theme"
        :can-install="canInstall"
        @open-sessions="emit('openSessions')"
        @toggle-theme="emit('toggleTheme')"
        @install="emit('install')"
      />
    </nav>
  </div>
</template>
