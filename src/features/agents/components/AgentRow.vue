<script setup lang="ts">
import type { AttentionItem } from '@/features/attention'
import type { Agent } from '@/types'
import { computed, ref } from 'vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppButton from '@/components/ui/AppButton.vue'
import WorkspaceBadge from '@/components/ui/WorkspaceBadge.vue'
import { useNow } from '@/composables/useNow'
import { usePermissionResolve } from '@/composables/usePermissionResolve'
import { toast } from '@/composables/useToast'
import { useAgentIdentity } from '@/features/agents/composables/useAgentIdentity'
import { agentActivity, agentTitle } from '@/utils/agentLabels'
import { attentionFor } from '@/utils/attention'
import { formatBurnRate, formatCost, formatRelativeActivity, isAwaitingInput, secondsSince, shortModel, totalTokenCount } from '@/utils/format'
import { agentDisplayStatus, statusLabel } from '@/utils/statusColors'

/*
 * One agent as a dense list row, with the card's hierarchy (3L):
 *
 *   state · attention · name · repository and workspace · activity · when · cost
 *
 * The same words as the card: the canonical name (agentTitle), the display
 * state (the working signal wins over the 30s status bucket), the canonical
 * attention item's chip, and the activity rule in utils/agentLabels. Nothing
 * path-, command- or transcript-shaped is on the row or in its expansion —
 * those live in the details panel, one click away.
 */
const props = defineProps<{
  agent: Agent
  /** This agent's canonical attention item, when it has one. */
  attention?: AttentionItem | null
}>()
const emit = defineEmits<{
  select: [agent: Agent]
}>()

const { getIdentity } = useAgentIdentity()
const { nowMs } = useNow()
const { resolving, resolveAgent } = usePermissionResolve()

const expanded = ref(false)

const agentName = computed(() => agentTitle(props.agent))
const displayStatus = computed(() => agentDisplayStatus(props.agent))
const activity = computed(() => agentActivity(props.agent))
const relActivity = computed(() => formatRelativeActivity(secondsSince(props.agent.lastActivity, nowMs.value)))
const burnRate = computed(() => formatBurnRate(props.agent.costEstimate, props.agent.uptime))
const awaitingInput = computed(() => isAwaitingInput(props.agent))

const attentionChip = computed(() => {
  if (!props.attention)
    return null
  return props.attention.level === 'failed'
    ? { word: 'Failed', tone: 'text-danger-text border-danger-line', edge: 'border-danger-dot' }
    : { word: 'Needs you', tone: 'text-warning-text border-warning-line', edge: 'border-warning-dot' }
})

/*
 * Inline approve/deny, only for a pipeline stage run's stored request, which
 * the task records against itself. Gated on the classifier underneath the
 * canonical queue, exactly as before.
 */
const resolvablePermission = computed(() => {
  const att = attentionFor(props.agent)
  return att?.kind === 'permission' && Boolean(props.agent.pipelineTaskId) && Boolean(props.agent.pendingPermissions?.length)
})

const activeSubagents = computed(() => (props.agent.subagents ?? []).filter(s => s.status === 'active').length)

async function handleResolve(outcome: 'granted' | 'denied') {
  const err = await resolveAgent(props.agent, outcome, false)
  if (err)
    toast.error(err)
}
</script>

<template>
  <div
    class="rounded-control overflow-hidden border bg-card transition-[border-color] duration-[var(--duration-fast)] ease-standard"
    :class="attentionChip?.edge ?? 'border-line'"
    data-testid="agent-row"
    :data-state="displayStatus"
    :data-attention="attention?.level"
  >
    <div class="flex items-center min-h-[40px]">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 cursor-pointer text-left bg-transparent border-none hover:bg-app focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:ring-inset"
        :aria-expanded="expanded"
        :aria-label="`${agentName} — ${statusLabel(displayStatus)}${attentionChip ? `, ${attentionChip.word}` : ''}`"
        @click="expanded = !expanded"
      >
        <AppBadge :variant="displayStatus" class="w-[76px] shrink-0" />
        <span
          v-if="attentionChip"
          class="shrink-0 rounded-control border bg-card px-1.5 py-px text-label font-semibold uppercase tracking-wide whitespace-nowrap"
          :class="attentionChip.tone"
          data-testid="agent-row-attention"
          :title="attention?.reason"
        >{{ attentionChip.word }}</span>

        <span aria-hidden="true" class="text-ui shrink-0">{{ getIdentity(agent.projectPath).emoji }}</span>
        <span class="w-[168px] shrink-0 truncate text-ui font-semibold text-fg" data-testid="agent-row-name">{{ agentName }}</span>

        <!-- Where: repository and workspace, by identity. Never a folder path. -->
        <span class="flex w-[260px] shrink-0 min-w-0 items-center gap-1.5 text-ui-sm text-fg-mute" data-testid="agent-row-where">
          <template v-if="agent.workspace?.id">
            <span
              v-if="agent.workspace.repository"
              class="min-w-0 max-w-[50%] truncate font-mono text-fg-soft"
              data-testid="agent-row-repository"
            >{{ agent.workspace.repository.name || 'Repository' }}</span>
            <span v-else class="min-w-0 truncate font-mono text-fg-soft" data-testid="agent-row-local-workspace">
              {{ agent.workspace.name }} <span class="font-sans text-fg-faint">local</span>
            </span>
            <WorkspaceBadge :workspace="agent.workspace" class="min-w-0 max-w-[10rem]" />
          </template>
          <span v-else class="text-fg-faint" data-testid="agent-row-workspace-unknown">Workspace unknown</span>
        </span>

        <span class="flex-1 min-w-0 truncate text-ui-sm text-fg-soft" data-testid="agent-row-activity">{{ activity }}</span>

        <span class="hidden lg:block shrink-0 w-14 font-mono text-label text-fg-mute">{{ shortModel(agent.model ?? null) }}</span>
        <span class="shrink-0 w-[76px] text-right font-mono text-label text-fg-mute">{{ relActivity }}</span>
        <span class="shrink-0 w-[56px] text-right font-mono text-label tabular-nums text-fg-soft" data-testid="agent-row-cost" title="Estimated session cost">
          <span v-if="agent.costUnknown" title="Cost unknown">?</span>
          <template v-else>{{ formatCost(agent.costEstimate) }}</template>
        </span>
        <span
          aria-hidden="true"
          class="text-fg-faint text-label shrink-0 transition-transform duration-[var(--duration-fast)]"
          :class="expanded ? 'rotate-90' : ''"
        >▸</span>
      </button>

      <!-- Inline approve/deny for a stored pipeline request. Outside the row button: nested controls are invalid. -->
      <span v-if="resolvablePermission" class="flex items-center gap-1.5 shrink-0 pr-3">
        <AppButton
          variant="success"
          size="sm"
          :disabled="resolving[agent.sessionId]"
          :aria-label="`Approve permission for ${agentName}`"
          @click="handleResolve('granted')"
        >
          ✓ Approve
        </AppButton>
        <AppButton
          variant="danger"
          size="sm"
          :disabled="resolving[agent.sessionId]"
          :aria-label="`Deny permission for ${agentName}`"
          @click="handleResolve('denied')"
        >
          ✕ Deny
        </AppButton>
      </span>
    </div>

    <!-- Expanded: compact facts, then the way to the details panel. -->
    <div v-if="expanded" class="flex flex-wrap items-center gap-1.5 border-t border-line bg-app px-3 py-2" data-testid="agent-row-expanded">
      <span v-if="attention" class="text-ui-sm text-fg-soft" data-testid="agent-row-attention-reason">{{ attention.reason }}</span>
      <span class="font-mono text-label px-1.5 py-0.5 rounded-control bg-raised text-fg-mute">{{ totalTokenCount(agent.tokenUsage).toLocaleString() }} tok</span>
      <span v-if="burnRate !== '—'" class="font-mono text-label px-1.5 py-0.5 rounded-control bg-raised text-fg-mute">{{ burnRate }}</span>
      <span v-if="activeSubagents > 0" class="text-label px-1.5 py-0.5 rounded-control bg-raised text-fg-mute">{{ activeSubagents }} {{ activeSubagents === 1 ? 'subagent' : 'subagents' }}</span>
      <span v-if="agent.spawnerName" class="text-label px-1.5 py-0.5 rounded-control bg-raised text-fg-mute">{{ agent.spawnerName }}</span>
      <AppBadge
        v-if="agent.internalProcess"
        variant="info"
        label="internal"
        title="Claude Code's own internal daemon process — not a session you can message"
        data-testid="agent-row-internal-badge"
      />
      <span
        v-if="awaitingInput"
        data-testid="agent-awaiting-input"
        class="text-label font-medium px-1 py-0.5 rounded-control bg-neutral-soft text-neutral-text"
        title="The agent finished its turn — it will not do anything else until you send it something"
      >your turn</span>
      <AppButton
        variant="outline"
        size="sm"
        class="ml-auto"
        :aria-label="`Open details for ${agentName}`"
        @click="emit('select', agent)"
      >
        Open details
      </AppButton>
    </div>
  </div>
</template>
