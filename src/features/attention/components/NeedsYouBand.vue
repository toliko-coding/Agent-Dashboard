<script setup lang="ts">
import type { AttentionItem, AttentionLevel, AttentionQueue } from '../queue'
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { workspaceDisplay } from '@/utils/agentGroup'
import { formatRelativeActivity, secondsSince } from '@/utils/format'

/*
 * "Needs you": the top of the Overview, and the one question it answers first.
 *
 * Populated, it is the loudest thing on the page — a title-size heading, the
 * level's colour on the whole panel, one row per item. Empty, it shrinks to a
 * single line: the absence of attention is not news, and it is not a health
 * report either, so the quiet line says only that nothing is waiting.
 *
 * Every row answers who, why, where and for how long, as far as the data can.
 * It never shows a path, a command, a question's text or any transcript: the
 * row identifies the problem and opens the surface where it is dealt with.
 */
const props = defineProps<{ queue: AttentionQueue }>()
const emit = defineEmits<{ select: [item: AttentionItem] }>()

// The shared 30s clock the roster already runs; one interval for every row.
const { nowMs } = useNow()

const LEVEL_LABELS: Record<AttentionLevel, string> = {
  blocking: 'Blocking',
  failed: 'Failed',
  stalled: 'Stalled',
  ready: 'Ready',
}

// Text colour, chip and row edge per level. Amber blocks, red failed, neutral
// otherwise; never cyan (live) and never green (success) — attention is neither.
//
// Chips sit on the card, coloured by word and border rather than a soft fill:
// the level word is 11px, and red text on the soft red fill measured 3.9:1 in
// the light theme. On the card the same red is 4.8:1 and the amber 4.9:1.
const LEVEL_STYLE: Record<AttentionLevel, { chip: string, row: string }> = {
  blocking: { chip: 'bg-card text-warning-text border-warning-line', row: 'border-warning-line' },
  failed: { chip: 'bg-card text-danger-text border-danger-line', row: 'border-danger-line' },
  stalled: { chip: 'bg-card text-neutral-text border-neutral-line', row: 'border-neutral-line' },
  ready: { chip: 'bg-card text-neutral-text border-neutral-line', row: 'border-line' },
}

const items = computed(() => props.queue.items)
const count = computed(() => items.value.length)
const topLevel = computed<AttentionLevel | null>(() => items.value[0]?.level ?? null)

const panelClass = computed(() => {
  switch (topLevel.value) {
    case 'blocking': return 'border-warning-line bg-warning-soft'
    case 'failed': return 'border-danger-line bg-danger-soft'
    default: return 'border-line bg-card'
  }
})

function where(item: AttentionItem): string {
  if (item.subject.type === 'task')
    return 'Pipeline task'
  if (item.subject.type === 'capability')
    return 'Dashboard server'
  if (item.subject.type === 'spawn')
    return 'Starting · not a session yet'
  const ws = item.workspace
  if (!ws)
    return 'Workspace unknown'
  const { title, kind } = workspaceDisplay(ws)
  if (ws.kind === 'plain')
    return `${title} · ${kind}`
  return `${item.repository?.name ?? 'Repository unknown'} · ${title} · ${kind}`
}

const SINCE_VERB: Partial<Record<AttentionItem['kind'], string>> = {
  'permission': 'requested',
  'task-permissions': 'requested',
  'capability': 'requested',
}

function when(item: AttentionItem): string {
  if (item.since)
    return `${SINCE_VERB[item.kind] ?? 'since'} ${formatRelativeActivity(secondsSince(item.since, nowMs.value))}`
  if (item.lastActivity)
    return `last activity ${formatRelativeActivity(secondsSince(item.lastActivity, nowMs.value))}`
  return ''
}

function accessibleName(item: AttentionItem): string {
  const parts = [LEVEL_LABELS[item.level], item.title, item.reason, where(item), item.detail, when(item)]
  return parts.filter(Boolean).join(', ')
}

/*
 * A targeted announcement, not a live section: only a BLOCKING item that was
 * not there on the previous update is announced, politely, once. The first
 * observation is not announced — it is the page arriving, not news — and
 * nothing re-announces while the list merely re-renders.
 */
const announcement = ref('')
let seenBlocking: Set<string> | null = null
watch(
  () => props.queue.status === 'ready'
    ? items.value.filter(i => i.level === 'blocking').map(i => i.id).join('|')
    : null,
  (key) => {
    if (key === null)
      return
    const blocking = items.value.filter(i => i.level === 'blocking')
    if (seenBlocking === null) {
      seenBlocking = new Set(blocking.map(i => i.id))
      return
    }
    const fresh = blocking.filter(i => !seenBlocking!.has(i.id))
    seenBlocking = new Set(blocking.map(i => i.id))
    if (fresh.length === 1)
      announcement.value = `Needs you: ${fresh[0].title}, ${fresh[0].reason}`
    else if (fresh.length > 1)
      announcement.value = `Needs you: ${fresh.length} new blocking items`
  },
  { immediate: true },
)
</script>

<template>
  <section
    class="rounded-panel border min-w-0"
    :class="count > 0 ? panelClass : 'border-line bg-card'"
    aria-labelledby="needs-you-heading"
    data-testid="needs-you"
    :data-status="queue.status"
    :data-count="queue.status === 'ready' ? count : undefined"
    :aria-busy="queue.status === 'loading'"
  >
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="needs-you-announcement">
      {{ announcement }}
    </p>

    <!-- Populated: the loudest thing on the page. -->
    <template v-if="queue.status === 'ready' && count > 0">
      <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3 pb-2">
        <h2 id="needs-you-heading" class="text-title font-semibold text-fg m-0">
          Needs you
        </h2>
        <span class="text-ui font-semibold tabular-nums text-fg-soft" data-testid="needs-you-count">
          {{ count }} waiting
        </span>
        <span v-if="queue.stale" class="ml-auto text-ui-sm text-fg-mute" data-testid="needs-you-stale">
          Last known state · agent updates reconnecting
        </span>
      </header>
      <ul class="flex flex-col gap-2 px-3 pb-3 m-0 list-none" data-testid="needs-you-list">
        <li v-for="item in items" :key="item.id" class="min-w-0">
          <button
            type="button"
            data-testid="needs-you-item"
            :data-level="item.level"
            :data-kind="item.kind"
            :aria-label="accessibleName(item)"
            class="w-full min-w-0 grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-control border bg-card px-3 py-2.5 text-left cursor-pointer hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            :class="[LEVEL_STYLE[item.level].row, item.level === 'blocking' ? 'motion-arrive-attention' : '']"
            @click="emit('select', item)"
          >
            <span
              class="mt-px rounded-control border px-1.5 py-0.5 text-label font-semibold uppercase tracking-wide whitespace-nowrap"
              :class="LEVEL_STYLE[item.level].chip"
              data-testid="needs-you-level"
            >{{ LEVEL_LABELS[item.level] }}</span>
            <span class="min-w-0 flex flex-col gap-0.5">
              <span class="flex flex-wrap items-baseline gap-x-2 min-w-0">
                <span class="text-ui font-semibold text-fg truncate max-w-full" data-testid="needs-you-title">{{ item.title }}</span>
                <span class="text-ui text-fg-soft" data-testid="needs-you-reason">{{ item.reason }}</span>
              </span>
              <span class="flex flex-wrap items-baseline gap-x-1.5 text-ui-sm text-fg-mute min-w-0">
                <span class="truncate max-w-full" data-testid="needs-you-where">{{ where(item) }}</span>
                <span v-if="item.detail" class="font-mono truncate max-w-full" data-testid="needs-you-detail">· {{ item.detail }}</span>
              </span>
            </span>
            <span class="text-ui-sm text-fg-mute whitespace-nowrap tabular-nums" data-testid="needs-you-when">{{ when(item) }}</span>
          </button>
        </li>
      </ul>
    </template>

    <!-- Quiet, loading and unavailable: one compact line each. -->
    <div v-else class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2">
      <h2 id="needs-you-heading" class="text-ui font-semibold text-fg m-0">
        Needs you
      </h2>
      <p v-if="queue.status === 'loading'" class="text-ui text-fg-mute m-0" data-testid="needs-you-loading">
        Checking agents and tasks…
      </p>
      <p v-else-if="queue.status === 'unavailable'" class="text-ui text-warning-text m-0" data-testid="needs-you-unavailable">
        Unknown — agent updates have not loaded yet.
      </p>
      <p v-else class="text-ui text-fg-mute m-0" data-testid="needs-you-quiet">
        {{ queue.stale
          ? 'Nothing was waiting on your decision at the last update · agent updates reconnecting'
          : 'Nothing is waiting on your decision.' }}
      </p>
    </div>
  </section>
</template>
