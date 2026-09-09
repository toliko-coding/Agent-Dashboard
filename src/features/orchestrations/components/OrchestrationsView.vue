<script setup lang="ts">
import { computed, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import ViewPlaceholder from '@/components/ViewPlaceholder.vue'
import { useActivityFeed } from '@/composables/useActivityFeed'
import { STAGE_LABELS } from '@/utils/stageLabels'
import { useOrchestrationDetail, useOrchestrationList } from '../composables/useOrchestrations'
import OrchestrationGraph from './OrchestrationGraph.vue'

/*
 * Orchestrations — read-only.
 *
 * This view SHOWS collaboration that already happened; it cannot cause any.
 * There is no spawn, no delegate, no advance and no cancel here, because this
 * phase adds no agent authority.
 *
 * Everything rendered is derived server-side from tasks and task_dependencies.
 * No health score, no ETA, no progress percentage beyond counting stored
 * stages — the pipeline records none of those, and inventing one would be a
 * claim the data cannot support.
 */
const { orchestrations, error: listError, loaded } = useOrchestrationList()

const selectedRootId = ref<string | null>(null)
const { detail, error: detailError, loading } = useOrchestrationDetail(selectedRootId)

const selectedTaskId = ref<string | null>(null)

const selectedTask = computed(() =>
  detail.value?.tasks.find(t => t.id === selectedTaskId.value) ?? null)

/*
 * Activity comes from the audit log the app already reads — the only real,
 * persisted event stream there is — filtered to the tasks in this tree. No
 * events are synthesised for the orchestration itself.
 */
const { events, loaded: activityLoaded } = useActivityFeed()
const treeTaskIds = computed(() => new Set(detail.value?.tasks.map(t => t.id) ?? []))
const orchestrationActivity = computed(() =>
  events.value.filter(e => e.taskId && treeTaskIds.value.has(e.taskId)).slice(0, 12))

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage
}

function select(rootId: string): void {
  selectedRootId.value = rootId
  selectedTaskId.value = null
}

function back(): void {
  selectedRootId.value = null
  selectedTaskId.value = null
}

const severityTone: Record<string, string> = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
  info: 'text-fg-mute',
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <!-- LIST -->
    <template v-if="!selectedRootId">
      <header class="flex items-baseline justify-between gap-3">
        <div>
          <h2 class="text-[15px] font-semibold text-fg">
            Orchestrations
          </h2>
          <p class="text-[12px] text-fg-mute">
            A root task and everything delegated beneath it. Derived from existing task links — read-only.
          </p>
        </div>
        <span v-if="loaded" class="text-[12px] text-fg-mute">
          {{ orchestrations.length }} {{ orchestrations.length === 1 ? 'orchestration' : 'orchestrations' }}
        </span>
      </header>

      <p v-if="listError" class="text-[13px] text-danger-text" role="alert">
        {{ listError }}
      </p>

      <p v-else-if="!loaded" class="text-[13px] text-fg-mute">
        Loading…
      </p>

      <!-- Empty is a real answer here, and says why: a standalone task is
           technically its own root, so it is not listed. -->
      <ViewPlaceholder
        v-else-if="orchestrations.length === 0"
        icon="⤳"
        title="No orchestrations yet"
        summary="An orchestration appears when a task has sub-tasks beneath it. Tasks without children are not listed — every one of them would otherwise be an orchestration of one."
        requires="Create a sub-task under an existing task"
      />

      <ul v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 list-none p-0 m-0">
        <li v-for="o in orchestrations" :key="o.rootTaskId">
          <AppCard interactive lift>
            <button
              type="button"
              class="w-full text-left p-4 flex flex-col gap-3"
              @click="select(o.rootTaskId)"
            >
              <div class="min-w-0">
                <p class="text-[13px] font-medium text-fg truncate">
                  {{ o.title }}
                </p>
                <p class="text-[11px] font-mono text-fg-faint truncate">
                  {{ o.slug }}
                </p>
              </div>

              <dl class="grid grid-cols-4 gap-2 text-center">
                <div>
                  <dt class="text-[10px] uppercase tracking-wide text-fg-faint">
                    Tasks
                  </dt>
                  <dd class="text-[13px] text-fg">
                    {{ o.counts.total }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[10px] uppercase tracking-wide text-fg-faint">
                    Active
                  </dt>
                  <dd class="text-[13px] text-fg">
                    {{ o.counts.active }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[10px] uppercase tracking-wide text-fg-faint">
                    Done
                  </dt>
                  <dd class="text-[13px] text-success-text">
                    {{ o.counts.done }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[10px] uppercase tracking-wide text-fg-faint">
                    On hold
                  </dt>
                  <dd class="text-[13px] text-warning-text">
                    {{ o.counts.blocked }}
                  </dd>
                </div>
              </dl>

              <p class="text-[11px] text-fg-mute">
                <!-- Cancelled is stated separately: it is terminal but not
                     delivered, so folding it into "done" would overstate what
                     this orchestration achieved. -->
                <span v-if="o.counts.cancelled > 0">{{ o.counts.cancelled }} cancelled · </span>
                <span v-if="o.spawnerIds.length > 0">{{ o.spawnerIds.join(', ') }}</span>
                <span v-else>No role assigned</span>
              </p>
            </button>
          </AppCard>
        </li>
      </ul>
    </template>

    <!-- DETAIL -->
    <template v-else>
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <button
            type="button"
            class="text-[12px] text-fg-mute hover:text-fg"
            @click="back"
          >
            ← All orchestrations
          </button>
          <h2 class="text-[15px] font-semibold text-fg truncate">
            {{ detail?.title ?? 'Orchestration' }}
          </h2>
          <p v-if="detail" class="text-[11px] font-mono text-fg-faint truncate">
            {{ detail.slug }}
          </p>
        </div>
      </header>

      <p v-if="detailError" class="text-[13px] text-danger-text" role="alert">
        {{ detailError }}
      </p>
      <p v-else-if="loading && !detail" class="text-[13px] text-fg-mute">
        Loading…
      </p>

      <template v-else-if="detail">
        <AppCard>
          <div class="p-4">
            <h3 class="text-[13px] font-medium text-fg mb-3">
              Structure
            </h3>
            <OrchestrationGraph
              :tasks="detail.tasks"
              :dependencies="detail.dependencies"
              :selected-id="selectedTaskId"
              @select="(id) => selectedTaskId = id"
            />
          </div>
        </AppCard>

        <div class="grid gap-3 lg:grid-cols-2">
          <AppCard>
            <div class="p-4">
              <h3 class="text-[13px] font-medium text-fg mb-2">
                Tasks
              </h3>
              <ul class="list-none p-0 m-0 flex flex-col gap-1">
                <li v-for="t in detail.tasks" :key="t.id">
                  <button
                    type="button"
                    class="w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-raised"
                    :class="{ 'bg-raised': t.id === selectedTaskId }"
                    @click="selectedTaskId = t.id"
                  >
                    <span :style="{ paddingLeft: `${t.depth * 12}px` }" class="text-[12px] text-fg truncate flex-1">
                      {{ t.title }}
                    </span>
                    <span class="text-[11px] text-fg-mute shrink-0">{{ stageLabel(t.stage) }}</span>
                  </button>
                </li>
              </ul>

              <div v-if="selectedTask" class="mt-3 border-t border-line pt-3 text-[12px] flex flex-col gap-1">
                <p class="font-mono text-[11px] text-fg-faint">
                  {{ selectedTask.slug }}
                </p>
                <p class="text-fg-mute">
                  Depth {{ selectedTask.depth }} · {{ stageLabel(selectedTask.stage) }} · {{ selectedTask.priority }}
                </p>
                <p class="text-fg-mute">
                  Role:
                  <span v-if="selectedTask.spawnerId">{{ selectedTask.spawnerId }}</span>
                  <!-- Unassigned is stated, not shown as a blank or a guess. -->
                  <span v-else class="text-fg-faint">unassigned</span>
                </p>
                <p class="text-fg-mute">
                  Created by:
                  <span v-if="selectedTask.delegatedByStageRunId" class="font-mono text-[11px]">
                    stage run {{ selectedTask.delegatedByStageRunId }}
                  </span>
                  <!-- Not "unknown": no agent created this, and saying so is the
                       accurate statement. -->
                  <span v-else class="text-fg-faint">a person (not delegated by an agent)</span>
                </p>
              </div>
            </div>
          </AppCard>

          <AppCard>
            <div class="p-4">
              <h3 class="text-[13px] font-medium text-fg mb-2">
                Activity
              </h3>
              <p class="text-[11px] text-fg-faint mb-2">
                From the server audit log, filtered to this orchestration's tasks.
              </p>
              <p v-if="!activityLoaded" class="text-[12px] text-fg-mute">
                Loading…
              </p>
              <p v-else-if="orchestrationActivity.length === 0" class="text-[12px] text-fg-mute">
                No audited events for these tasks in the recent log.
              </p>
              <ul v-else class="list-none p-0 m-0 flex flex-col gap-2">
                <li v-for="e in orchestrationActivity" :key="e.id" class="text-[12px]">
                  <span :class="severityTone[e.severity] ?? 'text-fg-mute'">{{ e.title }}</span>
                  <span class="text-fg-faint"> · {{ e.actor }}</span>
                  <time :datetime="e.timestampRaw" class="block text-[11px] text-fg-faint">
                    {{ e.timestampRaw }}
                  </time>
                </li>
              </ul>
            </div>
          </AppCard>
        </div>
      </template>
    </template>
  </section>
</template>
