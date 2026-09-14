<script setup lang="ts">
import type { ActiveView } from '../../composables/useViewState'
import { computed } from 'vue'
import { useNow } from '../../composables/useNow'
import { useRuntimeSection } from '../../composables/useRuntimeSection'
import { useSettingsSection } from '../../composables/useSettingsSection'
import { viewSection, viewTitle } from '../../utils/navConfig'
import { runtimeSectionMeta } from '../../utils/runtimeSections'
import { settingsSectionMeta } from '../../utils/settingsSections'
import OfflineBadge from '../OfflineBadge.vue'

const props = withDefaults(defineProps<{
  activeView: ActiveView
  /** Whether agent updates are arriving (useAgents' live). Undefined = unknown, rendered as neutral. */
  live?: boolean
  /** Short user label for the avatar chip. Omitted when auth is disabled. */
  userLabel?: string
}>(), {
  live: undefined,
  userLabel: undefined,
})

const emit = defineEmits<{ openSearch: [] }>()

const title = computed(() => viewTitle(props.activeView))
// Work or Insights for a view inside one of them; nothing for a single-view destination.
const section = computed(() => viewSection(props.activeView))
/*
 * On a page with its own sections, the open one: "Settings / Appearance",
 * "Runtime / Services". Real state, not a breadcrumb trail.
 */
const { activeSection: settingsSection } = useSettingsSection()
const { activeSection: runtimeSection } = useRuntimeSection()
const subsection = computed(() => {
  if (props.activeView === 'settings')
    return settingsSectionMeta(settingsSection.value).label
  if (props.activeView === 'localscope')
    return runtimeSectionMeta(runtimeSection.value).label
  return null
})

const { nowMs } = useNow()
// Ticks on the shared 30s clock, so the minute display can lag by up to 30s —
// acceptable for ambient chrome, and it costs no extra timer.
const clock = computed(() =>
  new Date(nowMs.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))

/*
 * Only what `live` measures: whether agent updates are arriving (the agents
 * stream open, or a fallback poll succeeding — useAgents). It said "System
 * Online", a claim about the whole system that nothing measures. The sidebar
 * reads the same flag and says the same thing.
 */
const statusLabel = computed(() => {
  if (props.live === undefined)
    return 'Connecting…'
  return props.live ? 'Agent updates live' : 'Reconnecting…'
})

/*
 * Static on purpose. A connected stream is a steady state, not ongoing activity,
 * so it must not pulse forever to look alive — that is exactly the decorative
 * motion that teaches the eye to ignore the motion that does mean something.
 * Connected is shown in the live colour, because it describes live observation,
 * not success.
 */
const statusDotClass = computed(() => {
  if (props.live === undefined)
    return 'bg-fg-faint'
  return props.live ? 'bg-live-dot' : 'bg-warning'
})

const initials = computed(() => (props.userLabel ?? '').trim().slice(0, 2).toUpperCase())
</script>

<template>
  <header class="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-line bg-card">
    <span v-if="section" class="text-[12px] text-fg-mute shrink-0" data-testid="topbar-section">{{ section }} <span aria-hidden="true">/</span></span>
    <h1 class="text-[15px] font-semibold text-fg shrink-0">
      {{ title }}
    </h1>
    <span v-if="subsection" class="text-[13px] text-fg-mute shrink-0" data-testid="topbar-subsection"><span aria-hidden="true">/</span> {{ subsection }}</span>

    <!--
      A button, not an input. It opens the existing global Spotlight (⌘K), which
      searches tasks and agents — and the copy says exactly that. It promised
      "agents, projects, or commands" until 3B; neither projects nor commands are
      searchable yet, so the trigger names only what the palette really does. A real <input> here would re-introduce
      the bug the topbar test guards against: a field that looks like a filter
      but narrows nothing on any view except the agent roster.
    -->
    <button
      type="button"
      data-testid="topbar-search"
      class="hidden md:flex items-center gap-2 flex-1 max-w-[420px] h-8 px-3 rounded-md border border-line bg-app text-fg-faint hover:text-fg-mute hover:border-line-strong transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:border-accent"
      aria-label="Search tasks and agents"
      aria-keyshortcuts="Meta+K Control+K"
      @click="emit('openSearch')"
    >
      <span aria-hidden="true" class="text-[12px]">⌕</span>
      <span class="text-[12px] truncate">Search tasks and agents…</span>
      <kbd class="ml-auto shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded border border-line text-fg-faint">⌘K</kbd>
    </button>

    <div class="ml-auto flex items-center gap-3">
      <span class="hidden lg:flex items-center gap-1.5 text-[11px] text-fg-mute" role="status">
        <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="statusDotClass" aria-hidden="true" />
        {{ statusLabel }}
      </span>
      <time
        class="hidden lg:block text-[11px] font-mono tabular-nums text-fg-faint"
        :datetime="new Date(nowMs).toISOString()"
      >{{ clock }}</time>
      <slot name="cta" />
      <OfflineBadge />
      <span
        v-if="initials"
        data-testid="topbar-avatar"
        class="w-7 h-7 shrink-0 rounded-full bg-raised border border-line grid place-items-center text-[10px] font-semibold text-fg-mute"
        :title="userLabel"
      >{{ initials }}</span>
    </div>
  </header>
</template>
