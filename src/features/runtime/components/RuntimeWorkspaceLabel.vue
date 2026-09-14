<script setup lang="ts">
import type { WorkspaceRef } from '@/types'
import { computed } from 'vue'
import { workspaceDisplay } from '@/utils/agentGroup'

/*
 * Which repository and workspace an observed service or process belongs to.
 *
 * Attribution is the server-resolved WorkspaceRef and nothing else. A row
 * without one says "Workspace unknown" — never its cwd, a discovered project
 * name or a folder, which is exactly the guess that attaches one checkout's
 * server to another. No path is shown: the repository name, the branch and
 * the workspace kind are the facts a person needs, and they use the same words
 * as the Agents roster and the topology.
 */
const props = defineProps<{ workspace: WorkspaceRef | null }>()

const known = computed(() => Boolean(props.workspace?.id))
const display = computed(() => props.workspace ? workspaceDisplay(props.workspace) : null)
const isPlain = computed(() => props.workspace?.kind === 'plain')
</script>

<template>
  <span v-if="!known || !workspace || !display" class="text-ui-sm text-fg-mute" data-testid="runtime-workspace-unknown">
    Workspace unknown
  </span>
  <span
    v-else
    class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-ui-sm"
    data-testid="runtime-workspace"
    :data-workspace-id="workspace.id"
  >
    <span v-if="isPlain" class="font-mono text-fg-soft truncate">{{ workspace.name }}</span>
    <span v-else class="font-mono text-fg-soft truncate">{{ workspace.repository?.name || 'Repository' }}</span>
    <template v-if="!isPlain">
      <span class="text-fg-faint" aria-hidden="true">⑂</span>
      <span class="font-mono text-fg-soft break-all">{{ display.title }}</span>
    </template>
    <span class="text-fg-mute">{{ display.kind }}</span>
  </span>
</template>
