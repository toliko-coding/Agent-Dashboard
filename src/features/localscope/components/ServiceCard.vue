<script setup lang="ts">
import type { LocalService } from '../types'
import AppCard from '@/components/ui/AppCard.vue'
import CopyButton from '@/components/ui/CopyButton.vue'

/*
 * A listening port presented in developer terms. LocalScope has already done
 * the classification work (`label`, `kind`, `project`), so this component only
 * presents it — it never re-derives what a port "is".
 *
 * `confidence` covers label/kind/project, NOT port/pid. A low-confidence guess
 * is marked so nothing inferred is read as observed.
 */
defineProps<{ service: LocalService }>()
</script>

<template>
  <AppCard interactive lift>
    <div class="p-3 flex flex-col gap-2 min-w-0" :data-testid="`service-${service.id}`">
      <div class="flex items-start gap-2 min-w-0">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-[13px] font-semibold text-fg truncate">
              {{ service.project?.name ?? service.processName }}
            </span>
            <span
              v-if="service.confidence === 'low'"
              class="shrink-0 text-[9px] px-1 py-0.5 rounded bg-warning-soft text-warning-text"
              title="LocalScope inferred this from weak evidence — treat it as a guess"
            >guess</span>
          </div>
          <div class="text-[11px] text-fg-mute truncate">
            {{ service.label }}
          </div>
        </div>
        <span class="shrink-0 inline-flex items-center gap-1.5 text-[11px]">
          <span class="size-2 rounded-full bg-success-dot" aria-hidden="true" />
          <span class="text-success-text">RUNNING</span>
        </span>
      </div>

      <div class="flex items-center gap-1 min-w-0">
        <a
          v-if="service.url"
          :href="service.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-[12px] font-mono text-accent hover:underline truncate rounded focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        >{{ service.url }}</a>
        <span v-else class="text-[12px] font-mono text-fg-mute truncate">
          {{ service.address }}:{{ service.port }}
        </span>
        <CopyButton :value="service.url ?? `${service.address}:${service.port}`" label="service address" />
      </div>

      <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div class="flex gap-1.5 min-w-0">
          <dt class="text-fg-faint shrink-0">
            Port
          </dt>
          <dd class="font-mono text-fg-soft">
            {{ service.port }}
          </dd>
        </div>
        <div class="flex gap-1.5 min-w-0">
          <dt class="text-fg-faint shrink-0">
            PID
          </dt>
          <dd class="font-mono text-fg-soft">
            {{ service.pid }}
          </dd>
        </div>
        <div class="flex gap-1.5 min-w-0">
          <dt class="text-fg-faint shrink-0">
            Runtime
          </dt>
          <dd class="font-mono text-fg-soft truncate">
            {{ service.runtime }}
          </dd>
        </div>
        <div class="flex gap-1.5 min-w-0">
          <dt class="text-fg-faint shrink-0">
            Scope
          </dt>
          <dd
            class="font-mono truncate"
            :class="service.bindScope === 'all' ? 'text-warning-text' : 'text-fg-soft'"
            :title="service.bindScope === 'all' ? 'Bound to all interfaces — reachable from your network' : undefined"
          >
            {{ service.bindScope }}
          </dd>
        </div>
      </dl>

      <div v-if="service.project" class="flex items-center gap-1 min-w-0">
        <!-- dir="rtl" keeps the END of a long path visible, which is the part
             that identifies the project; plain truncate would cut it off. -->
        <span
          class="text-[10px] text-fg-faint font-mono truncate text-left"
          dir="rtl"
          :title="service.project.rootPath"
        >{{ service.project.displayPath }}</span>
        <span v-if="service.project.git.branch" class="text-[10px] text-fg-mute shrink-0">· {{ service.project.git.branch }}</span>
        <CopyButton :value="service.project.rootPath" label="project path" />
      </div>
    </div>
  </AppCard>
</template>
