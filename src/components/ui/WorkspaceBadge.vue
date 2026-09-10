<script setup lang="ts">
import type { WorkspaceRef } from '@/types'
import { computed } from 'vue'

/*
 * The checkout an agent is running in.
 *
 * This exists because two worktrees of one repository were previously
 * indistinguishable on a roster: both cards showed the same project name —
 * basename(cwd) — and nothing else in the payload separated them. The branch is
 * the fact that tells them apart, and it is the fact a person actually needs.
 *
 * Renders NOTHING in three cases, each for its own reason:
 *
 *   workspace null   identity could not be resolved. Unknown is not a state to
 *                    illustrate, and falling back to a folder name is exactly
 *                    the guess this model replaces.
 *   kind 'plain'     not a git checkout, so there is no branch to show. Saying
 *                    "no branch" would imply one was expected.
 *   no branch/detach nothing observed worth stating.
 *
 * No path is displayed. The workspace root is an ancestor of the cwd shown
 * elsewhere on the card, and a long absolute path in a metadata row is noise;
 * the branch is the part that carries meaning.
 */
const props = defineProps<{ workspace: WorkspaceRef | null }>()

const branchText = computed(() => {
  const ws = props.workspace
  if (!ws || ws.kind === 'plain')
    return null
  if (ws.detached)
    return 'detached'
  return ws.branch || null
})

/*
 * A linked worktree is marked even though its branch usually differs anyway.
 * "Usually" is not "always" — a detached worktree and its main checkout can
 * both read `detached` — and the distinction is the point of the model, so it
 * is stated rather than inferred from the branch happening to differ.
 */
const isWorktree = computed(() => props.workspace?.kind === 'git-worktree')

const title = computed(() => {
  if (!branchText.value)
    return ''
  const where = isWorktree.value ? 'linked worktree' : 'main checkout'
  return `${branchText.value} — ${where}`
})
</script>

<template>
  <span
    v-if="branchText"
    class="inline-flex items-center gap-1 min-w-0 whitespace-nowrap"
    :title="title"
    :data-testid="isWorktree ? 'workspace-branch-worktree' : 'workspace-branch'"
    :data-workspace-id="workspace?.id"
  >
    <span aria-hidden="true" class="text-fg-faint">⑂</span>
    <span
      class="truncate"
      :class="isWorktree ? 'text-state-working' : 'text-fg-mute'"
    >{{ branchText }}</span>
    <!--
      The marker is a word, not only a colour: colour alone would put the whole
      main-vs-worktree distinction behind colour vision.
    -->
    <span v-if="isWorktree" class="text-[9px] text-fg-faint" aria-hidden="true">worktree</span>
    <span class="sr-only">{{ title }}</span>
  </span>
</template>
