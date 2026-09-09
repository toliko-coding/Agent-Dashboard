<script setup lang="ts">
import type { Freshness } from '@/features/localscope'
import { computed, ref } from 'vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppChip from '@/components/ui/AppChip.vue'
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

/** The semantic motion vocabulary, with the claim each one makes. */
const MOTIONS = [
  { cls: 'motion-working', name: 'working', claim: 'The system is busy and nothing is wrong.', color: 'bg-state-working' },
  { cls: 'motion-tool', name: 'tool', claim: 'A discrete step is executing right now.', color: 'bg-state-tool' },
  { cls: 'motion-waiting', name: 'waiting', claim: 'A person has to act before this moves.', color: 'bg-state-waiting' },
  { cls: 'motion-success', name: 'success', claim: 'It finished. An event, not a state.', color: 'bg-state-success' },
]

const SURFACES = [
  { token: '--app', cls: 'bg-app', role: 'The page ground.' },
  { token: '--card', cls: 'bg-card', role: 'A panel lifted off the ground.' },
  { token: '--raised', cls: 'bg-raised', role: 'A control or a nested block.' },
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

      <!-- Motion vocabulary -->
      <section class="flex flex-col gap-3">
        <h2 class="text-[13px] font-semibold">
          Motion vocabulary
        </h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="m in MOTIONS"
            :key="m.name"
            class="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2"
          >
            <span
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

      <!-- Surfaces and text -->
      <section class="grid gap-6 md:grid-cols-2">
        <div class="flex flex-col gap-3">
          <h2 class="text-[13px] font-semibold">
            Surfaces
          </h2>
          <div
            v-for="s in SURFACES"
            :key="s.token"
            class="flex items-center gap-3 rounded-md border border-line p-3"
            :class="s.cls"
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
