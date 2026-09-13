<script setup lang="ts">
import type { AttentionItem, AttentionQueue } from '@/features/attention'
import type { Freshness } from '@/features/localscope'
import { computed, ref } from 'vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppChip from '@/components/ui/AppChip.vue'
import { NeedsYouBand } from '@/features/attention'
import { DataFreshnessIndicator } from '@/features/localscope'

/*
 * Design-system showcase. Development only.
 *
 * Mounted by App.vue behind `import.meta.env.DEV` and an explicit
 * `#design-sandbox` hash, so it has no navigation entry, no route, and no
 * presence in a production bundle at all — the guard is a compile-time
 * constant, so this component and its fixtures are tree-shaken out entirely.
 *
 * Every value below is a literal written here. Nothing on this page reads a
 * store, a poller or an endpoint: a showcase that renders live data would
 * misreport the machine the moment the collector went away, and fake data must
 * never reach a surface that also shows real data.
 */

const emit = defineEmits<{ close: [] }>()

const STATES = ['active', 'working', 'waiting', 'idle', 'finished', 'completed', 'error', 'info'] as const

interface MotionSample { cls: string, name: string, claim: string, color: string, flow?: boolean }

/** The semantic motion vocabulary, with the claim each one makes. */
const MOTIONS: MotionSample[] = [
  { cls: 'motion-working', name: 'working', claim: 'The system is busy and nothing is wrong.', color: 'bg-state-working' },
  { cls: 'motion-tool', name: 'tool', claim: 'A discrete step is executing right now.', color: 'bg-state-tool' },
  { cls: 'motion-waiting', name: 'waiting', claim: 'A person has to act before this moves.', color: 'bg-state-waiting' },
  { cls: 'motion-success', name: 'success', claim: 'It finished. An event, not a state.', color: 'bg-state-success' },
  // Drawn on an edge, not a dot: live flow says data is moving through a link.
  { cls: 'motion-flow', name: 'live flow', claim: 'Data is flowing through this connection right now.', color: '', flow: true },
]

/*
 * Phase 3B foundation. Each entry names the utility the token generates, so the
 * sandbox doubles as proof that the token actually emits CSS.
 */
const TYPE_SCALE = [
  { cls: 'text-title-lg', px: 22, role: 'View title' },
  { cls: 'text-title', px: 18, role: 'Section heading' },
  { cls: 'text-body', px: 15, role: 'Running text' },
  { cls: 'text-ui', px: 13, role: 'Controls and dense rows' },
  { cls: 'text-ui-sm', px: 12, role: 'Smallest readable UI text' },
  { cls: 'text-label', px: 11, role: 'Kind labels and technical captions only' },
]

const RADII = [
  { cls: 'rounded-control', px: 4, role: 'Controls, pills, compact nodes' },
  { cls: 'rounded-panel', px: 8, role: 'Cards, panels, major surfaces' },
]

/* Semantic state colours: each is a word first, a colour second. */
const STATE_COLORS = [
  { token: '--state-working', dot: 'bg-state-working', text: 'text-state-working', label: 'Working', meaning: 'Busy, and nothing is wrong.' },
  { token: '--state-waiting', dot: 'bg-state-waiting', text: 'text-state-waiting', label: 'Needs you', meaning: 'A person has to act.' },
  { token: '--state-error', dot: 'bg-state-error', text: 'text-state-error', label: 'Error', meaning: 'A fault.' },
  { token: '--state-success', dot: 'bg-state-success', text: 'text-state-success', label: 'Completed', meaning: 'Finished, or healthy.' },
  { token: '--state-live', dot: 'bg-state-live', text: 'text-live-text', label: 'Live', meaning: 'Data observed or flowing right now.' },
  { token: '--state-idle', dot: 'bg-state-idle', text: 'text-fg-mute', label: 'Idle', meaning: 'Nothing is happening.' },
]

const SURFACES = [
  { token: '--app', cls: 'bg-app', role: 'The page ground.' },
  { token: '--card', cls: 'bg-card', role: 'A panel lifted off the ground.' },
  { token: '--raised', cls: 'bg-raised', role: 'A control or a nested block.' },
  { token: '--recessed', cls: 'bg-recessed', role: 'Logs, transcripts, diagnostics.' },
]

const TEXT = [
  { token: '--fg', cls: 'text-fg', role: 'Primary. Headings and values.' },
  { token: '--fg-soft', cls: 'text-fg-soft', role: 'Body.' },
  { token: '--fg-mute', cls: 'text-fg-mute', role: 'Secondary and captions.' },
  { token: '--fg-faint', cls: 'text-fg-faint', role: 'Metadata. Lowest that still passes AA.' },
]

function reading(over: Partial<Freshness>): Freshness {
  return { source: 'ready', collectedAt: null, ageMs: null, degraded: [], ...over } as Freshness
}

const FRESHNESS = [
  { label: 'ready', reading: reading({}), means: 'Collected, current, complete. Renders nothing.' },
  { label: 'degraded', reading: reading({ degraded: [{ source: 'simctl', reason: 'x', kind: 'partial' }] }), means: 'Current. One source had trouble.' },
  { label: 'stale', reading: reading({ source: 'stale', ageMs: 183_000 }), means: 'Was true. May not describe the machine now.' },
  { label: 'both', reading: reading({ source: 'stale', ageMs: 42_000, degraded: [{ source: 'ps', reason: 'x', kind: 'partial' }] }), means: 'Staleness outranks degradation.' },
]

/** Live check so a reviewer can see what the OS is actually reporting. */
const reducedMotion = computed(() =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

const showMotion = ref(true)

/*
 * Attention states, rendered by the production NeedsYouBand. Stalled has no
 * producer in the queue yet (see features/attention/queue.ts), so it is not
 * shown as if it could happen.
 */
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const SAMPLE_WORKTREE = { id: 'ws-sample', name: 'Agent-Dashboard', kind: 'git-worktree' as const, branch: 'feat/command-center-ui', repository: { id: 'repo-sample', name: 'Agent-Dashboard' } }
const SAMPLE_ITEMS: AttentionItem[] = [
  { id: 'agent:sample-question', level: 'blocking', kind: 'question', subject: { type: 'agent', sessionId: 'sample-question' }, agentSessionId: 'sample-question', workspace: SAMPLE_WORKTREE, repository: SAMPLE_WORKTREE.repository, title: 'Claude session 3f2a1b9c', reason: 'Question waiting for your answer', since: null, lastActivity: minutesAgo(6) },
  { id: 'agent:sample-permission', level: 'blocking', kind: 'permission', subject: { type: 'agent', sessionId: 'sample-permission' }, agentSessionId: 'sample-permission', workspace: null, repository: null, title: 'Fix login redirect', reason: 'Permission request waiting', detail: 'Bash', since: minutesAgo(3), lastActivity: minutesAgo(3) },
  { id: 'agent:sample-failed', level: 'failed', kind: 'api-error', subject: { type: 'agent', sessionId: 'sample-failed' }, agentSessionId: 'sample-failed', workspace: SAMPLE_WORKTREE, repository: SAMPLE_WORKTREE.repository, title: 'Codex session 9c01d2e4', reason: 'Rate limited', detail: 'API error reported by the session', since: null, lastActivity: minutesAgo(12) },
  { id: 'task:sample-review', level: 'ready', kind: 'task-waiting', subject: { type: 'task', taskId: 'sample-review' }, agentSessionId: null, workspace: null, repository: null, title: 'Refactor billing export', reason: 'Pipeline task waiting for you', detail: 'Plan review', since: null, lastActivity: null },
]
const ATTENTION_SAMPLES: { label: string, queue: AttentionQueue }[] = [
  { label: 'Blocking, failed and ready', queue: { status: 'ready', stale: false, items: SAMPLE_ITEMS } },
  { label: 'One failed item', queue: { status: 'ready', stale: false, items: [SAMPLE_ITEMS[2]] } },
  { label: 'Last known, reconnecting', queue: { status: 'ready', stale: true, items: [SAMPLE_ITEMS[1]] } },
  { label: 'Quiet', queue: { status: 'ready', stale: false, items: [] } },
  { label: 'Loading', queue: { status: 'loading', stale: false, items: [] } },
  { label: 'Unavailable', queue: { status: 'unavailable', stale: false, items: [] } },
]
</script>

<template>
  <div class="fixed inset-0 z-[200] overflow-y-auto bg-app text-fg" data-testid="design-sandbox">
    <header class="sticky top-0 z-10 flex items-baseline gap-3 border-b border-line bg-app/95 px-6 py-3 backdrop-blur">
      <h1 class="text-[15px] font-semibold">
        Design system
      </h1>
      <span class="text-[11px] font-mono text-fg-faint">development only · #design-sandbox</span>
      <span
        v-if="reducedMotion"
        class="text-[11px] font-mono text-state-waiting"
        data-testid="reduced-motion-active"
      >prefers-reduced-motion is ON — motion below is intentionally still</span>
      <div class="ml-auto flex items-center gap-2">
        <AppButton size="sm" variant="ghost" @click="showMotion = !showMotion">
          {{ showMotion ? 'Freeze motion' : 'Resume motion' }}
        </AppButton>
        <AppButton size="sm" variant="ghost" @click="emit('close')">
          Close
        </AppButton>
      </div>
    </header>

    <div class="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-6">
      <!-- Principle -->
      <section class="rounded-lg border border-line bg-card p-4">
        <h2 class="text-[13px] font-semibold">
          Animation = information
        </h2>
        <p class="mt-1 max-w-3xl text-[12px] text-fg-mute">
          Something moves because the system is doing something, and stops when that stops. Motion that runs
          regardless of state teaches the eye to ignore it, which costs the real signals their meaning. Motion is
          always redundant with colour and text, never the only encoding — which is what makes removing it for
          reduced-motion safe.
        </p>
      </section>

      <!-- Agent states -->
      <section class="flex flex-col gap-3">
        <h2 class="text-[13px] font-semibold">
          Agent states
        </h2>
        <p class="text-[12px] text-fg-mute">
          Only <span class="font-mono">working</span> animates. Every other state is at rest, so movement anywhere on
          a roster means something is genuinely happening.
        </p>
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div
            v-for="s in STATES"
            :key="s"
            class="flex flex-col gap-1 rounded-md border border-line bg-card px-3 py-2"
            :class="showMotion ? '' : '[&_*]:!animate-none'"
          >
            <AppBadge :variant="s" />
            <code class="text-[10px] text-fg-faint">{{ s }}</code>
          </div>
        </div>
      </section>

      <!-- Attention -->
      <section class="flex flex-col gap-3" data-testid="sandbox-attention">
        <h2 class="text-[13px] font-semibold">
          Needs you
        </h2>
        <p class="max-w-3xl text-[12px] text-fg-mute">
          The production band. Blocking is amber and rings once as it arrives, failed is red, ready is neutral; nothing
          loops. Stalled has no producer yet, so it is not illustrated. Empty, it is a single line that makes no claim
          about health.
        </p>
        <div
          v-for="sample in ATTENTION_SAMPLES"
          :key="sample.label"
          class="flex flex-col gap-1"
          :data-testid="`sandbox-attention-${sample.queue.status}-${sample.queue.items.length}`"
          :class="showMotion ? '' : '[&_*]:!animate-none'"
        >
          <code class="text-[10px] text-fg-faint">{{ sample.label }}</code>
          <NeedsYouBand :queue="sample.queue" />
        </div>
      </section>

      <!-- Motion vocabulary -->
      <section class="flex flex-col gap-3" data-testid="sandbox-motion">
        <h2 class="text-[13px] font-semibold">
          Motion vocabulary
        </h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="m in MOTIONS"
            :key="m.name"
            class="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2"
          >
            <svg
              v-if="m.flow"
              class="h-2.5 w-10 shrink-0"
              viewBox="0 0 40 10"
              aria-hidden="true"
              data-testid="sandbox-motion-flow"
            >
              <line
                x1="1" y1="5" x2="39" y2="5"
                stroke="var(--color-live-dot)" stroke-width="2" stroke-dasharray="6 6"
                :class="showMotion ? m.cls : ''"
              />
            </svg>
            <span
              v-else
              class="size-2.5 shrink-0 rounded-full"
              :class="[m.color, showMotion ? m.cls : '']"
              aria-hidden="true"
            />
            <code class="w-24 shrink-0 text-[11px] text-fg-soft">{{ m.name }}</code>
            <span class="text-[12px] text-fg-mute">{{ m.claim }}</span>
          </li>
        </ul>
      </section>

      <!-- Data freshness -->
      <section class="flex flex-col gap-3">
        <h2 class="text-[13px] font-semibold">
          Data freshness
        </h2>
        <p class="text-[12px] text-fg-mute">
          Four distinguishable claims. A reading that is current and complete says nothing at all.
        </p>
        <ul class="flex flex-col gap-2">
          <li
            v-for="f in FRESHNESS"
            :key="f.label"
            class="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2"
          >
            <code class="w-20 shrink-0 text-[11px] text-fg-soft">{{ f.label }}</code>
            <span class="w-40 shrink-0"><DataFreshnessIndicator :reading="f.reading" /></span>
            <span class="text-[12px] text-fg-mute">{{ f.means }}</span>
          </li>
        </ul>
      </section>

      <!-- Type scale (3B) -->
      <section class="flex flex-col gap-3" data-testid="sandbox-type-scale">
        <h2 class="text-[13px] font-semibold">
          Type scale
        </h2>
        <p class="text-[12px] text-fg-mute">
          Interface text stays in the system font. 12px is the floor for readable text on redesigned surfaces; 11px is
          for kind labels and technical captions only.
        </p>
        <ul class="flex flex-col divide-y divide-line rounded-panel border border-line bg-card">
          <li v-for="t in TYPE_SCALE" :key="t.cls" class="flex items-baseline gap-4 px-3 py-2" :data-testid="`sandbox-type-${t.cls}`">
            <code class="w-28 shrink-0 text-[11px] text-fg-faint">{{ t.cls }}</code>
            <code class="w-10 shrink-0 text-[11px] text-fg-faint tabular-nums">{{ t.px }}px</code>
            <span class="text-fg" :class="t.cls">{{ t.role }}</span>
          </li>
        </ul>
        <p class="text-ui-sm text-fg-mute">
          Technical values use Fira Code, self-hosted:
          <span class="font-mono text-fg-soft">feat/command-center-ui · pid 84451 · :5173 · claude-opus-5</span>
        </p>
      </section>

      <!-- Radius (3B) -->
      <section class="flex flex-col gap-3" data-testid="sandbox-radius">
        <h2 class="text-[13px] font-semibold">
          Radius
        </h2>
        <div class="flex flex-wrap gap-3">
          <div
            v-for="r in RADII"
            :key="r.cls"
            class="flex min-w-[220px] flex-1 flex-col gap-1 border border-line-strong bg-card p-3"
            :class="r.cls"
            :data-testid="`sandbox-radius-${r.cls}`"
          >
            <code class="text-[11px] text-fg-soft">{{ r.cls }} · {{ r.px }}px</code>
            <span class="text-[12px] text-fg-mute">{{ r.role }}</span>
          </div>
        </div>
      </section>

      <!-- Semantic state colours (3B) -->
      <section class="flex flex-col gap-3" data-testid="sandbox-state-colors">
        <h2 class="text-[13px] font-semibold">
          Semantic state colours
        </h2>
        <p class="text-[12px] text-fg-mute">
          A colour is never the whole message: every swatch carries its word.
        </p>
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="c in STATE_COLORS"
            :key="c.token"
            class="flex items-center gap-2 rounded-control border border-line bg-card px-3 py-2"
            :data-testid="`sandbox-state-${c.token.replace('--state-', '')}`"
          >
            <span class="size-2.5 shrink-0 rounded-full" :class="c.dot" aria-hidden="true" />
            <span class="text-[13px] font-medium" :class="c.text">{{ c.label }}</span>
            <span class="text-[12px] text-fg-faint">{{ c.meaning }}</span>
          </li>
        </ul>
      </section>

      <!-- Live vs success (3B, decision D3) -->
      <section class="flex flex-col gap-3" data-testid="sandbox-live-vs-success">
        <h2 class="text-[13px] font-semibold">
          Live is not success
        </h2>
        <p class="text-[12px] text-fg-mute">
          Cyan means data is being observed or is flowing right now. Green means something finished or is healthy.
          Until 3B they shared a colour, so a live connection and a completed task looked the same.
        </p>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div class="flex items-center gap-3 rounded-panel border border-live-line bg-live-soft px-3 py-2.5" data-testid="sandbox-live-example">
            <svg class="h-2.5 w-10 shrink-0" viewBox="0 0 40 10" aria-hidden="true">
              <line
                x1="1" y1="5" x2="39" y2="5"
                stroke="var(--color-live-dot)" stroke-width="2" stroke-dasharray="6 6"
                :class="showMotion ? 'motion-flow' : ''"
              />
            </svg>
            <span class="text-[13px] font-medium text-live-text">Live</span>
            <span class="text-[12px] text-fg-mute">LocalScope reading arriving</span>
          </div>
          <div class="flex items-center gap-3 rounded-panel border border-success-line bg-success-soft px-3 py-2.5" data-testid="sandbox-success-example">
            <span class="size-2.5 shrink-0 rounded-full bg-state-success" aria-hidden="true" />
            <span class="text-[13px] font-medium text-success-text">Completed</span>
            <span class="text-[12px] text-fg-mute">Task finished</span>
          </div>
        </div>
      </section>

      <!-- Surfaces and text -->
      <section class="grid gap-6 md:grid-cols-2" data-testid="sandbox-surfaces">
        <div class="flex flex-col gap-3">
          <h2 class="text-[13px] font-semibold">
            Surfaces
          </h2>
          <div
            v-for="s in SURFACES"
            :key="s.token"
            class="flex items-center gap-3 rounded-md border border-line p-3"
            :class="s.cls"
            :data-testid="`sandbox-surface-${s.token.replace('--', '')}`"
          >
            <code class="w-20 shrink-0 text-[11px] text-fg-soft">{{ s.token }}</code>
            <span class="text-[12px] text-fg-mute">{{ s.role }}</span>
          </div>
        </div>
        <div class="flex flex-col gap-3">
          <h2 class="text-[13px] font-semibold">
            Text hierarchy
          </h2>
          <div
            v-for="t in TEXT"
            :key="t.token"
            class="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2"
          >
            <code class="w-24 shrink-0 text-[11px]" :class="t.cls">{{ t.token }}</code>
            <span class="text-[12px]" :class="t.cls">{{ t.role }}</span>
          </div>
        </div>
      </section>

      <!-- Chips and buttons -->
      <section class="flex flex-col gap-3">
        <h2 class="text-[13px] font-semibold">
          Controls
        </h2>
        <div class="flex flex-wrap items-center gap-2 rounded-md border border-line bg-card p-3">
          <AppChip tone="success">
            success
          </AppChip>
          <AppChip tone="warning">
            warning
          </AppChip>
          <AppChip tone="danger">
            danger
          </AppChip>
          <AppChip tone="info">
            info
          </AppChip>
          <AppChip tone="neutral">
            neutral
          </AppChip>
          <AppChip tone="accent">
            accent
          </AppChip>
        </div>
        <div class="flex flex-wrap items-center gap-2 rounded-md border border-line bg-card p-3">
          <AppButton size="sm">
            Primary
          </AppButton>
          <AppButton size="sm" variant="secondary">
            Secondary
          </AppButton>
          <AppButton size="sm" variant="ghost">
            Ghost
          </AppButton>
          <AppButton size="sm" variant="danger">
            Danger
          </AppButton>
        </div>
      </section>
    </div>
  </div>
</template>
