<script setup lang="ts">
import type { TopologyWorkspace } from '../runtimeTopology'
import type { Agent } from '@/types'
import { computed } from 'vue'
import { workspaceDisplay } from '@/utils/agentGroup'
import { shortModel } from '@/utils/format'
import { friendlyProjectName } from '@/utils/friendlyProjectName'
import { agentDisplayStatus, statusLabel } from '@/utils/statusColors'

/*
 * One workspace and what runs in it.
 *
 * Workspace words come from workspaceDisplay, the helper the Agents roster
 * grouping uses, so "main checkout", "worktree", "Detached HEAD", "Branch
 * unknown" and "not a Git repository" mean one thing on both surfaces.
 *
 * No path is shown. The workspace is identified by its branch and kind; a
 * worktree also shows its directory name, the one safe distinguishing fact
 * when two of them are detached.
 */
const props = defineProps<{
  node: TopologyWorkspace
  servicesKnown: boolean
  processesKnown: boolean
}>()

const display = computed(() => workspaceDisplay(props.node.workspace))
const isPlain = computed(() => props.node.workspace.kind === 'plain')
const showName = computed(() =>
  props.node.workspace.kind === 'git-worktree'
  && !!props.node.workspace.name
  && props.node.workspace.name !== display.value.title)

const MAX_PROCESS_NAMES = 4
const processNames = computed(() => {
  const names = [...new Set(props.node.processes.map(p => p.name))]
  const shown = names.slice(0, MAX_PROCESS_NAMES).join(', ')
  return names.length > MAX_PROCESS_NAMES ? `${shown}, …` : shown
})

const ports = computed(() =>
  [...new Set(props.node.services.map(s => s.port))].sort((a, b) => a - b).map(p => `:${p}`).join(' '))

function agentLabel(agent: Agent): string {
  return `${friendlyProjectName(agent.projectName)} · ${statusLabel(agentDisplayStatus(agent))} · ${shortModel(agent.model ?? null)}`
}

const listLabel = computed(() => isPlain.value
  ? `Local workspace ${props.node.workspace.name}, not in a Git repository`
  : `${props.node.workspace.kind === 'git-worktree' ? 'Worktree' : 'Main checkout'} workspace ${display.value.title}`)
</script>

<template>
  <div
    class="ml-1 pl-3 border-l border-line flex flex-col gap-1 min-w-0"
    data-testid="topology-workspace"
    :data-workspace-id="node.workspace.id"
    :data-workspace-kind="node.workspace.kind"
  >
    <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 text-[11px]">
      <span class="text-[10px] uppercase tracking-wider text-fg-faint">{{ isPlain ? 'Local workspace' : 'Workspace' }}</span>
      <span v-if="!isPlain" class="text-fg-faint" aria-hidden="true">⑂</span>
      <span class="font-mono text-fg-soft break-all">{{ display.title }}</span>
      <span class="text-fg-mute">{{ display.kind }}</span>
      <span v-if="showName" class="font-mono text-fg-faint break-all">{{ node.workspace.name }}</span>
    </p>

    <ul class="flex flex-col gap-0.5 text-[11px] min-w-0" :aria-label="listLabel">
      <li
        v-for="a in node.agents"
        :key="`${a.sessionId}-${a.pid}`"
        class="flex items-baseline gap-2 min-w-0"
        data-testid="topology-agent"
      >
        <span class="text-[10px] uppercase tracking-wider text-fg-faint w-16 shrink-0">Agent</span>
        <span class="text-fg truncate">{{ agentLabel(a) }}</span>
      </li>
      <li v-if="node.agents.length === 0" class="flex items-baseline gap-2" data-testid="topology-no-agents">
        <span class="text-[10px] uppercase tracking-wider text-fg-faint w-16 shrink-0">Agents</span>
        <span class="text-fg-faint">none observed</span>
      </li>

      <!-- Omitted entirely when the list was not reported; stated once above the tree. -->
      <li v-if="processesKnown" class="flex items-baseline gap-2 min-w-0" data-testid="topology-processes">
        <span class="text-[10px] uppercase tracking-wider text-fg-faint w-16 shrink-0">Processes</span>
        <span v-if="node.processes.length > 0" class="text-fg-mute truncate">{{ node.processes.length }} — {{ processNames }}</span>
        <span v-else class="text-fg-faint">none observed</span>
      </li>

      <li v-if="servicesKnown" class="flex items-baseline gap-2 min-w-0" data-testid="topology-services">
        <span class="text-[10px] uppercase tracking-wider text-fg-faint w-16 shrink-0">Services</span>
        <span v-if="node.services.length > 0" class="font-mono text-success-text break-all">{{ ports }}</span>
        <span v-else class="text-fg-faint">none observed</span>
      </li>
    </ul>
  </div>
</template>
