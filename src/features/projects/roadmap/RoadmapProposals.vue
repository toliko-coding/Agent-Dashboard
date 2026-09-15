<script setup lang="ts">
import type { ProposalChangeKind, ProposalDiffRow, Roadmap, RoadmapProposal } from './roadmapModel'
import type { Agent } from '@/types'
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { agentIsDashboardOwned } from '@/composables/useAgentLifecycle'
import { agentTitle } from '@/utils/agentLabels'
import { diffCounts, normalizeTitle, proposalDiff, STATUS_GLYPHS, STATUS_LABELS } from './roadmapModel'

/*
 * AI roadmap proposals (Phase 4B, review reworked in 4.1). The flow is explicit
 * at every step:
 *
 *   Analyze with AI   starts a Project Intelligence agent in the project's
 *                     folder (dashboard-owned; Claude's own trust and
 *                     permission prompts apply)
 *   Import proposal   reads that agent's final structured result — offered
 *                     only for dashboard-owned agents running in this project
 *   Review            Current vs Suggested, phase by phase: New, Changed,
 *                     Not in proposal, Unchanged. Add imports only the New
 *                     phases; Replace (after confirming) swaps the roadmap for
 *                     the proposal; Reject changes nothing.
 *
 * A proposal never changes the roadmap on its own. What is accepted is marked
 * Suggested until someone edits it.
 */
const props = defineProps<{
  proposals: RoadmapProposal[]
  /** The roadmap as it is now; null while there is none. */
  roadmap: Roadmap | null
  /** Agents in this project's folders. */
  agents: Agent[]
  busy: boolean
}>()
const emit = defineEmits<{
  analyze: []
  import: [pid: number]
  accept: [proposalId: string, mode: 'append' | 'replace']
  reject: [proposalId: string]
}>()

const pending = computed(() => props.proposals.filter(p => p.status === 'pending'))
const decided = computed(() => props.proposals.filter(p => p.status !== 'pending').slice(0, 3))
// Only an agent the dashboard started can hand in a proposal; the server enforces the same.
const importable = computed(() => props.agents.filter(a => agentIsDashboardOwned(a)))
const confirmReplace = ref<string | null>(null)

const hasRoadmap = computed(() => (props.roadmap?.phases.length ?? 0) > 0)
const diffs = computed(() => new Map(pending.value.map(p => [p.id, proposalDiff(props.roadmap, p.payload)])))
const rowsOf = (p: RoadmapProposal): ProposalDiffRow[] => diffs.value.get(p.id) ?? []
const countsOf = (p: RoadmapProposal) => diffCounts(rowsOf(p))
const linkedItems = computed(() => (props.roadmap?.phases ?? []).reduce((n, ph) => n + ph.items.filter(i => i.task).length, 0))

const KIND_LABEL: Record<ProposalChangeKind, string> = {
  add: 'New',
  change: 'Changed',
  remove: 'Not in proposal',
  unchanged: 'Unchanged',
}
const KIND_GLYPH: Record<ProposalChangeKind, string> = { add: '+', change: '~', remove: '−', unchanged: '=' }
const KIND_TONE: Record<ProposalChangeKind, string> = {
  add: 'border-state-success/60 text-success-text',
  change: 'border-state-waiting text-warning-text',
  remove: 'border-danger-line text-danger-text',
  unchanged: 'border-line text-fg-mute',
}

function statusText(row: ProposalDiffRow): string {
  if (row.kind === 'add')
    return `${STATUS_LABELS[row.proposed!.status]}${row.proposed!.current ? ' · proposed current' : ''}`
  if (row.kind === 'remove')
    return `${STATUS_LABELS[row.current!.status]} · kept by Add, deleted by Replace`
  return STATUS_LABELS[row.current!.status]
}
function itemKnown(row: ProposalDiffRow, title: string): boolean {
  const key = normalizeTitle(title)
  return (row.current?.items ?? []).some(i => normalizeTitle(i.title) === key)
}
function phases(n: number): string {
  return `${n} phase${n === 1 ? '' : 's'}`
}
</script>

<template>
  <section class="cc-card flex min-w-0 flex-col gap-3 rounded-xl border border-line p-4" aria-labelledby="roadmap-proposals-title" data-testid="roadmap-proposals">
    <div class="flex flex-wrap items-center gap-2">
      <h3 id="roadmap-proposals-title" class="m-0 text-body font-semibold text-fg">
        AI proposals
      </h3>
      <span class="text-ui-sm text-fg-mute">reviewed by you before anything changes</span>
      <AppButton class="ml-auto" variant="outline" :disabled="busy" data-testid="roadmap-analyze" @click="emit('analyze')">
        Analyze with AI
      </AppButton>
    </div>
    <p class="m-0 text-ui-sm text-fg-mute">
      Starts a Project Intelligence agent in this project's folder. It reads the README, docs, package metadata and git history and returns a proposed roadmap. It is told not to change files, and it cannot change the roadmap.
    </p>

    <div v-if="importable.length" class="flex flex-col gap-1.5" data-testid="roadmap-import">
      <span class="text-label font-semibold uppercase tracking-wider text-fg-mute">Import a finished proposal</span>
      <div v-for="a in importable" :key="`${a.sessionId}-${a.pid}`" class="flex min-w-0 items-center gap-2 text-ui">
        <span class="min-w-0 flex-1 truncate text-fg">{{ agentTitle(a) }}</span>
        <span class="text-ui-sm text-fg-mute">{{ a.working ? 'still working' : a.status }}</span>
        <AppButton variant="outline" size="sm" :disabled="busy || a.working" :data-testid="`roadmap-import-${a.pid}`" @click="emit('import', a.pid)">
          Import proposal
        </AppButton>
      </div>
    </div>

    <article
      v-for="p in pending"
      :key="p.id"
      class="flex flex-col gap-2.5 rounded-lg border border-accent/40 bg-app/40 p-3"
      :aria-labelledby="`roadmap-proposal-title-${p.id}`"
      :data-testid="`roadmap-proposal-${p.id}`"
    >
      <div class="flex flex-wrap items-center gap-2">
        <h4 :id="`roadmap-proposal-title-${p.id}`" class="m-0 text-ui font-semibold text-fg">
          {{ hasRoadmap ? 'Current vs Suggested' : 'Suggested roadmap' }} · {{ phases(p.payload.phases.length) }}
        </h4>
        <span class="ml-auto text-ui-sm text-fg-mute">{{ new Date(p.createdAt).toLocaleString() }}</span>
      </div>
      <p v-if="hasRoadmap" class="m-0 flex flex-wrap gap-x-3 gap-y-1 text-ui-sm" data-testid="roadmap-diff-counts">
        <span class="text-success-text">+ {{ countsOf(p).add }} new</span>
        <span class="text-warning-text">~ {{ countsOf(p).change }} changed</span>
        <span class="text-danger-text">− {{ countsOf(p).remove }} not in proposal</span>
        <span class="text-fg-mute">= {{ countsOf(p).unchanged }} unchanged</span>
      </p>
      <p v-if="p.payload.objective" class="m-0 text-ui text-fg-soft">
        <span class="text-fg-mute">Suggested objective:</span> {{ p.payload.objective }}
        <span v-if="roadmap?.objective && roadmap.objective !== p.payload.objective" class="block text-ui-sm text-fg-mute">Current objective stays unless you replace the roadmap.</span>
      </p>
      <p v-if="p.summary" class="m-0 text-ui-sm text-fg-mute">
        {{ p.summary }}
      </p>

      <ol class="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Phases in this proposal">
        <li
          v-for="row in rowsOf(p)"
          :key="`${row.kind}-${row.title}`"
          class="flex min-w-0 items-start gap-2 border-t border-line/60 pt-1.5 first:border-t-0 first:pt-0"
          :data-kind="row.kind"
          data-testid="roadmap-diff-row"
        >
          <span class="mt-px inline-flex shrink-0 items-center gap-1 rounded border px-1.5 font-mono text-[10px] uppercase leading-4 tracking-wider" :class="KIND_TONE[row.kind]">
            <span aria-hidden="true">{{ KIND_GLYPH[row.kind] }}</span>{{ KIND_LABEL[row.kind] }}
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-ui text-fg">
              <span aria-hidden="true">{{ STATUS_GLYPHS[(row.proposed ?? row.current)!.status] }}</span> {{ row.title }}
              <span class="text-ui-sm text-fg-mute"> — {{ statusText(row) }}</span>
            </span>
            <ul v-if="row.changes.length" class="m-0 flex list-none flex-col p-0 text-ui-sm text-fg-soft">
              <li v-for="c in row.changes" :key="c">
                {{ c }}
              </li>
            </ul>
            <details v-if="row.proposed?.items?.length" class="text-ui-sm text-fg-mute" data-testid="roadmap-diff-items">
              <summary class="cursor-pointer select-none">
                Proposed items ({{ row.proposed.items.length }})
              </summary>
              <ul class="m-0 mt-1 flex flex-col gap-0.5 pl-4">
                <li v-for="(item, i) in row.proposed.items" :key="i" class="break-words">
                  <span aria-hidden="true">{{ STATUS_GLYPHS[item.status] }}</span> {{ item.title }}
                  <span class="text-fg-faint"> — {{ STATUS_LABELS[item.status] }}<template v-if="row.current && !itemKnown(row, item.title)"> · not on the roadmap</template></span>
                </li>
              </ul>
            </details>
            <details v-if="row.proposed?.evidence?.length" class="text-ui-sm text-fg-mute">
              <summary class="cursor-pointer select-none">
                Evidence ({{ row.proposed.evidence.length }})
              </summary>
              <ul class="m-0 mt-1 flex flex-col gap-0.5 pl-4">
                <li v-for="(e, i) in row.proposed.evidence" :key="i" class="break-words">
                  {{ e }}
                </li>
              </ul>
            </details>
          </div>
        </li>
      </ol>

      <p class="m-0 text-ui-sm text-fg-mute" data-testid="roadmap-proposal-explain">
        <template v-if="hasRoadmap">
          <strong class="font-semibold text-fg-soft">Add</strong> imports only the {{ phases(countsOf(p).add) }} marked New; every current phase stays exactly as it is.
          <strong class="font-semibold text-fg-soft">Replace</strong> deletes the current roadmap and uses this proposal instead.
        </template>
        <template v-else>
          <strong class="font-semibold text-fg-soft">Accept</strong> creates these {{ phases(p.payload.phases.length) }}.
        </template>
        Accepted phases are marked Suggested until you edit them.
      </p>
      <div class="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <AppButton
          variant="primary"
          size="sm"
          :disabled="busy || (hasRoadmap && countsOf(p).add === 0)"
          :data-testid="`roadmap-accept-${p.id}`"
          @click="emit('accept', p.id, 'append')"
        >
          {{ hasRoadmap ? `Add ${phases(countsOf(p).add)}` : 'Accept proposal' }}
        </AppButton>
        <template v-if="hasRoadmap">
          <AppButton v-if="confirmReplace !== p.id" variant="outline" size="sm" :disabled="busy" :data-testid="`roadmap-replace-start-${p.id}`" @click="confirmReplace = p.id">
            Replace roadmap…
          </AppButton>
          <template v-else>
            <span class="text-ui-sm text-warning-text" role="status" data-testid="roadmap-replace-warning">
              Deletes all {{ phases(roadmap!.phases.length) }}<template v-if="linkedItems"> and {{ linkedItems }} task-linked item{{ linkedItems === 1 ? '' : 's' }}</template>, then adds the {{ phases(p.payload.phases.length) }} proposed.
            </span>
            <AppButton variant="danger" size="sm" :disabled="busy" :data-testid="`roadmap-replace-${p.id}`" @click="emit('accept', p.id, 'replace')">
              Replace
            </AppButton>
            <AppButton variant="outline" size="sm" :disabled="busy" @click="confirmReplace = null">
              Keep current
            </AppButton>
          </template>
        </template>
        <AppButton variant="outline" size="sm" class="ml-auto" :disabled="busy" :data-testid="`roadmap-reject-${p.id}`" @click="emit('reject', p.id)">
          Reject
        </AppButton>
      </div>
    </article>

    <p v-if="pending.length === 0" class="m-0 text-ui-sm text-fg-mute" data-testid="roadmap-no-proposals">
      No proposal waiting for review.
    </p>
    <p v-for="p in decided" :key="p.id" class="m-0 text-ui-sm text-fg-faint">
      {{ p.status === 'accepted' ? 'Accepted' : 'Rejected' }} proposal · {{ new Date(p.decidedAt ?? p.createdAt).toLocaleString() }}
    </p>
  </section>
</template>
