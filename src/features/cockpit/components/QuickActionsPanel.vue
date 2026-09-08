<script setup lang="ts">
import type { ActiveView } from '@/composables/useViewState'
import CockpitPanel from './CockpitPanel.vue'

/*
 * Every action here routes to a destination that exists, or invokes a dialog
 * that exists. Nothing is added because it "looks" like a command center would
 * have it — a button that does nothing is worse than an absent one.
 *
 * "New Agent" is emitted upward rather than handled here because the spawn
 * dialog is owned by App.vue, which is also where the topbar's + New Agent
 * button opens it. Two entry points, one dialog.
 */
const emit = defineEmits<{ navigate: [view: ActiveView], newAgent: [] }>()

const ACTIONS: { id: string, label: string, hint: string, icon: string, view?: ActiveView }[] = [
  { id: 'new-agent', label: 'New Agent', hint: 'Start a Claude session', icon: '＋' },
  { id: 'agents', label: 'Agents', hint: 'Full roster', icon: '▦', view: 'dashboard' },
  { id: 'projects', label: 'Projects', hint: 'Registered folders', icon: '◫', view: 'projects' },
  { id: 'pipeline', label: 'Pipeline', hint: 'Task board', icon: '▤', view: 'pipeline' },
  { id: 'terminal', label: 'Terminal', hint: 'Attach to an agent', icon: '▮', view: 'terminal' },
  { id: 'system', label: 'System', hint: 'Host resources', icon: '⬢', view: 'system' },
]

function run(action: typeof ACTIONS[number]): void {
  if (action.view)
    emit('navigate', action.view)
  else
    emit('newAgent')
}
</script>

<template>
  <CockpitPanel id="quickactions" title="Quick Actions" state="ready">
    <div class="grid grid-cols-2 gap-1.5" data-testid="quick-actions">
      <button
        v-for="a in ACTIONS"
        :key="a.id"
        type="button"
        :data-testid="`quick-action-${a.id}`"
        class="flex items-center gap-2 rounded-md border border-line bg-app px-2.5 py-2 text-left min-w-0 hover:border-line-strong hover:bg-raised transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        @click="run(a)"
      >
        <span class="text-[13px] text-fg-mute shrink-0" aria-hidden="true">{{ a.icon }}</span>
        <span class="min-w-0 flex flex-col">
          <span class="text-[12px] font-semibold text-fg truncate">{{ a.label }}</span>
          <span class="text-[10px] text-fg-faint truncate">{{ a.hint }}</span>
        </span>
      </button>
    </div>
  </CockpitPanel>
</template>
