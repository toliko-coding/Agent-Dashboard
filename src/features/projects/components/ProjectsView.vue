<script setup lang="ts">
import { computed } from 'vue'
import AppCard from '../../../components/ui/AppCard.vue'
import { useProjects } from '../../../composables/useProjects'

/*
 * Projects are a real, server-backed entity (GET /api/projects + SSE), so this
 * view renders live data. What a project does NOT carry today is any link to
 * running agents, local services, processes or a git remote — those columns do
 * not exist on the entity. They are therefore absent here rather than guessed;
 * Phase 4 can add them once a join exists to derive them honestly.
 */
const { projects, isLoading, error } = useProjects()

const sorted = computed(() => [...projects.value].sort((a, b) => a.name.localeCompare(b.name)))
</script>

<template>
  <section class="flex flex-col gap-3">
    <p v-if="isLoading && !sorted.length" class="text-[13px] text-fg-mute">
      Loading projects…
    </p>

    <p v-else-if="error" class="text-[13px] text-danger-text">
      {{ error }}
    </p>

    <p v-else-if="!sorted.length" class="text-[13px] text-fg-mute">
      No projects registered yet. Add one from Settings → Projects, or when creating an agent.
    </p>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      <AppCard v-for="p in sorted" :key="p.id" interactive lift>
        <div class="p-3 flex flex-col gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0 border border-line"
              :style="p.color ? { backgroundColor: p.color } : undefined"
              aria-hidden="true"
            />
            <span class="text-[13px] font-semibold text-fg truncate">{{ p.name }}</span>
            <span class="ml-auto shrink-0 text-[10px] font-mono text-fg-faint">
              {{ p.folderCount ?? p.folders?.length ?? 0 }}
              {{ (p.folderCount ?? p.folders?.length ?? 0) === 1 ? 'folder' : 'folders' }}
            </span>
          </div>

          <p v-if="p.description" class="text-[12px] text-fg-mute leading-snug line-clamp-2">
            {{ p.description }}
          </p>

          <ul v-if="p.folders?.length" class="flex flex-col gap-0.5">
            <li
              v-for="f in p.folders"
              :key="f.id"
              class="text-[10px] font-mono text-fg-faint truncate"
              :title="f.path"
            >
              {{ f.path }}
            </li>
          </ul>
        </div>
      </AppCard>
    </div>
  </section>
</template>
