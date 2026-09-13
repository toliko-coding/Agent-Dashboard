<script setup lang="ts">
import type { Agent, WorkspaceRef } from '@/types'
import { computed } from 'vue'
import { workspaceDisplay } from '@/utils/agentGroup'

/*
 * The second level of the repository-and-workspace grouping: one compact row
 * naming a workspace, above that workspace's agents.
 *
 * A row rather than a second collapsible header, on purpose. Almost every
 * repository has exactly one active checkout, and two full headers stacked on
 * each would double the chrome of the roster for no information. The row keeps
 * the workspace distinct — it is still its own group, keyed on its own id —
 * while staying visually light.
 *
 * Structural, not an activity signal: no state colour and no motion. The kind
 * of checkout is stated in words ("worktree", "main checkout", "not a Git
 * repository") so the hierarchy does not depend on indentation or colour.
 */
const props = defineProps<{ workspace: WorkspaceRef, agents: Agent[] }>()

const display = computed(() => workspaceDisplay(props.workspace))
const isPlain = computed(() => props.workspace.kind === 'plain')

/*
 * A worktree's directory name is shown beside its branch. Two detached
 * worktrees of one repository would otherwise read identically, and the name
 * is the one safe, human distinguishing fact (never a path).
 */
const showName = computed(() =>
  props.workspace.kind === 'git-worktree'
  && !!props.workspace.name
  && props.workspace.name !== display.value.title)

const count = computed(() => `${props.agents.length} ${props.agents.length === 1 ? 'agent' : 'agents'}`)

const spoken = computed(() => {
  if (isPlain.value)
    return `Local workspace ${props.workspace.name}, not in a Git repository, ${count.value}`
  const role = props.workspace.kind === 'git-worktree' ? 'Worktree' : 'Main checkout'
  const name = showName.value ? `, ${props.workspace.name}` : ''
  return `${role} workspace, ${display.value.title}${name}, ${count.value}`
})
</script>

<template>
  <p
    class="flex items-center gap-2 min-w-0 ml-2 pl-3 border-l border-line text-[11px]"
    data-testid="workspace-group-row"
    :data-workspace-id="workspace.id"
    :data-workspace-kind="workspace.kind"
  >
    <span class="text-[10px] uppercase tracking-wider text-fg-faint shrink-0" aria-hidden="true">{{ isPlain ? 'Local' : 'Workspace' }}</span>
    <span v-if="!isPlain" class="text-fg-faint shrink-0" aria-hidden="true">⑂</span>
    <span class="font-mono text-fg-soft truncate" aria-hidden="true">{{ display.title }}</span>
    <span class="text-fg-mute shrink-0" aria-hidden="true">{{ display.kind }}</span>
    <span v-if="showName" class="font-mono text-fg-faint truncate" aria-hidden="true">{{ workspace.name }}</span>
    <span class="text-fg-faint shrink-0" aria-hidden="true">{{ count }}</span>
    <span class="sr-only">{{ spoken }}</span>
  </p>
</template>
