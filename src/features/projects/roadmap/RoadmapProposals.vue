<script setup lang="ts">
import type { RoadmapProposal } from './roadmapModel'
import type { Agent } from '@/types'
import { computed, ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import { agentIsDashboardOwned } from '@/composables/useAgentLifecycle'
import { agentTitle } from '@/utils/agentLabels'
import { STATUS_GLYPHS, STATUS_LABELS } from './roadmapModel'

/*
 * AI roadmap proposals (Phase 4B). The flow is explicit at every step:
 *
 *   Analyze with AI   starts a Project Intelligence agent in the project's
 *                     folder (dashboard-owned; Claude's own trust and
 *                     permission prompts apply)
 *   Import proposal   reads that agent's final structured result — offered
 *                     only for dashboard-owned agents running in this project
 *   Review            accept (append, or replace after confirming) or reject
 *
 * A proposal never changes the roadmap on its own, and what is accepted is
 * marked Suggested.
 */
const props = defineProps<{
  proposals: RoadmapProposal[]
  /** Agents in this project's folders. */
  agents: Agent[]
  busy: boolean
  hasRoadmap: boolean
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
      Starts a Project Intelligence agent in this project's folder. It reads the README, docs, package metadata and git history and returns a proposed roadmap. It does not change files or the roadmap.
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
      class="flex flex-col gap-2 rounded-lg border border-accent/40 bg-app/40 p-3"
      :data-testid="`roadmap-proposal-${p.id}`"
    >
      <header class="flex flex-wrap items-center gap-2">
        <span class="rounded border border-line px-1 font-mono text-[10px] uppercase tracking-wider text-fg-mute">Suggested</span>
        <span class="text-ui font-semibold text-fg">Proposal · {{ p.payload.phases.length }} phases</span>
        <span class="ml-auto text-ui-sm text-fg-mute">{{ new Date(p.createdAt).toLocaleString() }}</span>
      </header>
      <p v-if="p.payload.objective" class="m-0 text-ui text-fg-soft">
        <span class="text-fg-mute">Objective:</span> {{ p.payload.objective }}
      </p>
      <p v-if="p.summary" class="m-0 text-ui-sm text-fg-mute">
        {{ p.summary }}
      </p>
      <ol class="m-0 flex flex-col gap-1.5 pl-5">
        <li v-for="(ph, i) in p.payload.phases" :key="i" class="text-ui">
          <span class="text-fg">{{ STATUS_GLYPHS[ph.status] }} {{ ph.title }}</span>
          <span class="text-ui-sm text-fg-mute"> — {{ STATUS_LABELS[ph.status] }}<template v-if="ph.current"> · proposed current</template></span>
          <span v-if="ph.evidence?.length" class="block truncate text-ui-sm text-fg-faint" :title="ph.evidence.join('\n')">Evidence: {{ ph.evidence.join(' · ') }}</span>
        </li>
      </ol>
      <footer class="flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <AppButton variant="primary" size="sm" :disabled="busy" :data-testid="`roadmap-accept-${p.id}`" @click="emit('accept', p.id, 'append')">
          {{ hasRoadmap ? 'Add to roadmap' : 'Accept' }}
        </AppButton>
        <template v-if="hasRoadmap">
          <AppButton v-if="confirmReplace !== p.id" variant="outline" size="sm" :disabled="busy" @click="confirmReplace = p.id">
            Replace roadmap…
          </AppButton>
          <template v-else>
            <span class="text-ui-sm text-warning-text">Replace every current phase?</span>
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
      </footer>
    </article>

    <p v-if="pending.length === 0" class="m-0 text-ui-sm text-fg-mute" data-testid="roadmap-no-proposals">
      No proposal waiting for review.
    </p>
    <p v-for="p in decided" :key="p.id" class="m-0 text-ui-sm text-fg-faint">
      {{ p.status === 'accepted' ? 'Accepted' : 'Rejected' }} proposal · {{ new Date(p.decidedAt ?? p.createdAt).toLocaleString() }}
    </p>
  </section>
</template>
