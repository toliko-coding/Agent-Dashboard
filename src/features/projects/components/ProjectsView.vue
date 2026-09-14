<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsSection } from '@/composables/useSettingsSection'
import { useProjects } from '../../../composables/useProjects'

/*
 * Projects are a real, server-backed entity (GET /api/projects + SSE), so this
 * view renders live data. What a project does NOT carry today is any link to
 * running agents, local services, processes or a git remote — those columns do
 * not exist on the entity. They are therefore absent here rather than guessed;
 * Phase 4 can add them once a join exists to derive them honestly.
 *
 * A Dashboard Project is the user's own grouping — not a repository and not a
 * workspace — so it is presented in its own terms: name, description, and the
 * folders it groups, by folder name. Full paths are managed, and shown, in
 * Settings → Projects; this overview does not put absolute paths on screen.
 */
const { projects, isLoading, error } = useProjects()

const PATH_SEPARATOR_RE = /[\\/]/

function folderName(path: string): string {
  return path.split(PATH_SEPARATOR_RE).filter(Boolean).pop() ?? path
}

const sorted = computed(() => [...projects.value].sort((a, b) => a.name.localeCompare(b.name)))

// The empty state's pointer to Settings is a link to that section, not an instruction.
const { openSettings } = useSettingsSection()
</script>

<template>
  <section class="flex flex-col gap-3" aria-labelledby="projects-heading">
    <h2 id="projects-heading" class="sr-only">
      Projects
    </h2>
    <p v-if="isLoading && !sorted.length" class="m-0 text-ui text-fg-mute">
      Loading projects…
    </p>

    <p v-else-if="error" class="m-0 text-ui text-danger-text">
      {{ error }}
    </p>

    <p v-else-if="!sorted.length" class="m-0 text-ui text-fg-mute" data-testid="projects-empty">
      No projects registered yet. Add one from
      <button type="button" data-testid="projects-open-settings" class="border-none bg-transparent p-0 font-inherit text-accent underline-offset-2 hover:underline cursor-pointer rounded focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent" @click="openSettings('projects')">
        Settings → Projects
      </button>, or when creating an agent.
    </p>

    <ul v-else class="m-0 p-0 list-none divide-y divide-line overflow-hidden rounded-panel border border-line bg-card" data-testid="projects-list">
      <li v-for="p in sorted" :key="p.id" class="flex min-w-0 flex-col gap-1 px-4 py-3" data-testid="project-row">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="size-2.5 shrink-0 rounded-full border border-line"
            :style="p.color ? { backgroundColor: p.color } : undefined"
            aria-hidden="true"
          />
          <span class="truncate text-ui font-semibold text-fg">{{ p.name }}</span>
          <span class="ml-auto shrink-0 text-ui-sm text-fg-mute">
            {{ p.folderCount ?? p.folders?.length ?? 0 }}
            {{ (p.folderCount ?? p.folders?.length ?? 0) === 1 ? 'folder' : 'folders' }}
          </span>
        </div>

        <p v-if="p.description" class="m-0 text-ui-sm text-fg-mute leading-snug line-clamp-2">
          {{ p.description }}
        </p>

        <p v-if="p.folders?.length" class="m-0 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="project-folders">
          <span class="text-label uppercase tracking-wider text-fg-faint">Folders</span>
          <span v-for="f in p.folders" :key="f.id" class="font-mono text-ui-sm text-fg-soft">{{ folderName(f.path) }}</span>
        </p>
      </li>
    </ul>
  </section>
</template>
