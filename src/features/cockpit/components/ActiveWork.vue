<script setup lang="ts">
import type { Agent } from '@/types'
import type { AgentGrouping } from '@/utils/agentGroup'
import { computed } from 'vue'
import { groupAgents, workspaceDisplay } from '@/utils/agentGroup'
import { workActivity } from '@/utils/agentLabels'
import ActiveWorkRow from './ActiveWorkRow.vue'

/*
 * Active work: the agents executing right now, shown where they run.
 *
 *   Repository   an outlined frame, named
 *     Workspace  a nested region led by its branch and checkout kind
 *       Agent    a compact operational row
 *
 * Grouping is the Agents roster's repository-and-workspace grouping, reused as
 * is: opaque RepositoryRef and WorkspaceRef ids only, never a folder name, cwd
 * or branch. Two repositories that share a name are two frames; a worktree is
 * its own region; an agent whose workspace was not resolved sits in a neutral
 * "Workspace unknown" frame rather than in the nearest plausible one.
 *
 * No motion on the hierarchy. Only a row's state dot moves, and only because
 * the agent is working.
 */
const props = defineProps<{
  /** Working agents only — see commandModel.activeWorkAgents. */
  agents: Agent[]
  status: 'loading' | 'ready'
  /** Last-known agents while updates reconnect. */
  stale: boolean
  /** Live agents in total, so the empty line can say the rest are not working. */
  totalAgents: number
}>()
const emit = defineEmits<{ select: [agent: Agent] }>()

const groups = computed(() => groupAgents(props.agents, 'workspace'))
// Of the working agents, those with an open tool call — named by tool on their rows.
const usingTools = computed(() => props.agents.filter(a => workActivity(a).state === 'tool').length)

const emptyText = computed(() => {
  if (props.totalAgents === 0)
    return 'No agent is working right now.'
  const rest = props.totalAgents === 1 ? 'One agent is' : `${props.totalAgents} agents are`
  return `No agent is working right now. ${rest} running but not working.`
})

const GROUP_WORD: Record<string, string> = {
  repository: 'Repository',
  local: 'Local workspaces',
  unknown: 'Workspace unknown',
}

function frameClass(group: AgentGrouping): string {
  return group.kind === 'unknown' ? 'border-dashed border-line' : 'border-line'
}

function workspaceTitle(group: AgentGrouping): { title: string, kind: string, dir: string | null } {
  const ws = group.workspace!
  const { title, kind } = workspaceDisplay(ws)
  // A worktree's directory name is the one safe distinguishing fact when two
  // worktrees are both detached — the same rule the runtime topology uses.
  const dir = ws.kind === 'git-worktree' && ws.name && ws.name !== title ? ws.name : null
  return { title, kind, dir }
}
</script>

<template>
  <section
    aria-labelledby="active-work-heading"
    data-testid="active-work"
    :data-status="status"
    class="rounded-panel border border-line bg-card min-w-0"
  >
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 pb-2">
      <h2 id="active-work-heading" class="m-0 text-title font-semibold text-fg">
        Active work
      </h2>
      <span v-if="status === 'ready' && agents.length > 0" class="text-ui font-semibold tabular-nums text-fg-soft" data-testid="active-work-count">
        {{ agents.length }} working
      </span>
      <span v-if="status === 'ready' && usingTools > 0" class="text-ui-sm text-fg-mute tabular-nums" data-testid="active-work-tools">
        · {{ usingTools }} using tools
      </span>
      <span v-if="stale" class="sm:ml-auto text-ui-sm text-fg-mute" data-testid="active-work-stale">
        Last known state · agent updates reconnecting
      </span>
    </header>

    <p v-if="status === 'loading'" class="m-0 px-4 pb-3 text-ui text-fg-mute" data-testid="active-work-loading">
      Checking agents…
    </p>
    <p v-else-if="agents.length === 0" class="m-0 px-4 pb-3 text-ui text-fg-mute" data-testid="active-work-empty">
      {{ emptyText }}
    </p>

    <ul v-else class="m-0 list-none flex flex-col gap-2.5 px-3 pb-3 min-w-0" aria-label="Working agents by repository and workspace">
      <li
        v-for="group in groups"
        :key="group.key"
        class="rounded-panel border min-w-0"
        :class="frameClass(group)"
        data-testid="active-work-group"
        :data-kind="group.kind"
        :data-group-key="group.key"
      >
        <p class="m-0 flex flex-wrap items-baseline gap-x-2 rounded-t-panel border-b border-line bg-raised/40 px-3 py-1.5 min-w-0">
          <span class="text-label uppercase tracking-wider text-fg-faint shrink-0">{{ GROUP_WORD[group.kind ?? ''] }}</span>
          <span
            v-if="group.kind === 'repository'"
            class="font-mono text-ui font-semibold text-fg truncate"
            data-testid="active-work-repository"
          >{{ group.label }}</span>
          <span v-else-if="group.kind === 'local'" class="text-ui-sm text-fg-mute">not in a Git repository</span>
          <span class="ml-auto shrink-0 text-ui-sm text-fg-mute tabular-nums" data-testid="active-work-group-count">{{ group.agents.length }} working</span>
        </p>

        <!-- Unresolved agents have no workspace to nest under. -->
        <ul v-if="group.kind === 'unknown'" class="m-0 list-none flex flex-col px-1 py-1.5" aria-label="Working agents with no resolved workspace">
          <li v-for="a in group.agents" :key="`${a.sessionId}-${a.pid}`">
            <ActiveWorkRow :agent="a" :stale="stale" @select="emit('select', $event)" />
          </li>
        </ul>

        <ul v-else class="m-0 list-none flex flex-col gap-1.5 px-2 py-2 min-w-0" :aria-label="`Workspaces in ${GROUP_WORD[group.kind ?? '']} ${group.kind === 'repository' ? group.label : ''}`.trim()">
          <li
            v-for="child in group.children"
            :key="child.key"
            class="ml-1 pl-2.5 border-l-2 border-line-strong min-w-0"
            data-testid="active-work-workspace"
            :data-workspace-id="child.workspace?.id"
            :data-workspace-kind="child.workspace?.kind"
          >
            <p class="m-0 flex flex-wrap items-baseline gap-x-2 px-1 pt-1 min-w-0">
              <span v-if="child.workspace?.kind !== 'plain'" class="text-fg-faint text-ui-sm" aria-hidden="true">⑂</span>
              <span class="font-mono text-ui text-fg-soft break-all" data-testid="active-work-branch">{{ workspaceTitle(child).title }}</span>
              <span class="text-ui-sm text-fg-mute">{{ workspaceTitle(child).kind }}</span>
              <span v-if="workspaceTitle(child).dir" class="font-mono text-ui-sm text-fg-faint break-all">{{ workspaceTitle(child).dir }}</span>
            </p>
            <ul class="m-0 list-none flex flex-col min-w-0" :aria-label="`Agents in ${workspaceTitle(child).title}`">
              <li v-for="a in child.agents" :key="`${a.sessionId}-${a.pid}`">
                <ActiveWorkRow :agent="a" :stale="stale" @select="emit('select', $event)" />
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </section>
</template>
