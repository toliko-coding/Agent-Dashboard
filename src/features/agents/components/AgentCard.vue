<script setup lang="ts">
import type { AttentionItem } from '@/features/attention'
import type { Agent } from '@/types'
import { computed, defineAsyncComponent, ref } from 'vue'
import MachineBadge from '@/components/MachineBadge.vue'
import PromptInput from '@/components/PromptInput.vue'
import ProviderBadge from '@/components/ProviderBadge.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppModal from '@/components/ui/AppModal.vue'
import WorkspaceBadge from '@/components/ui/WorkspaceBadge.vue'
import { useNow } from '@/composables/useNow'
import { toast } from '@/composables/useToast'
import AgentServiceChips from '@/features/agents/components/AgentServiceChips.vue'
import MetricsPopover from '@/features/agents/components/MetricsPopover.vue'
import { useAgentIdentity } from '@/features/agents/composables/useAgentIdentity'
import { agentTitle, workActivity } from '@/utils/agentLabels'
import { formatCost, formatRelativeActivity, isAwaitingInput, secondsSince, shortModel } from '@/utils/format'
import { agentDisplayStatus } from '@/utils/statusColors'

/*
 * An agent as a worker, not a miniature chat window: three compact rows.
 *
 *   state, attention, name, provider, model
 *   repository and workspace (or "Workspace unknown")
 *   what it is doing, role, subagents, last activity · cost and actions
 *
 * The transcript, subagent output, token and health figures, PID and paths are
 * not on the card. The agent's details (the modal) carry the transcript,
 * subagents and replies; the ⓘ popover carries uptime, tokens, health, burn
 * rate and cache cost. The card has no fixed height, so nothing it does show is
 * clipped.
 *
 * Attention is the canonical queue's item for this agent, passed in — the card
 * never decides it. A blocked agent is shown loudly once, in the triage band
 * above the roster, and quietly here, as a small chip.
 */
const props = defineProps<{
  agent: Agent
  /** This agent's canonical attention item, when it has one. */
  attention?: AttentionItem | null
}>()
const emit = defineEmits<{ select: [agent: Agent], dismiss: [pid: number] }>()

const isFinished = computed(() => props.agent.status === 'finished')

// The 'waiting' relabel lives in statusLabel() (src/utils/statusColors.ts, SSOT),
// so the card, the roster row and the modal cannot disagree about the same
// agent. Only the explanatory tooltip is card-local.
const displayStatus = computed(() => agentDisplayStatus(props.agent))
const statusBadgeTitle = computed(() => displayStatus.value === 'waiting'
  ? 'No new activity for a bit — the agent process is still alive, not waiting on you'
  : undefined)

async function dismiss() {
  const pid = props.agent.pid
  try {
    await fetch(`/api/agents/${pid}/channel`, { method: 'DELETE', credentials: 'same-origin' })
  }
  catch {
    // best-effort: the next SSE frame still reflects server truth
  }
  emit('dismiss', pid)
}

const { getIdentity } = useAgentIdentity()
const { nowMs } = useNow()

const title = computed(() => agentTitle(props.agent))
const awaitingInput = computed(() => isAwaitingInput(props.agent))

/*
 * What the agent is doing. Tool names only — never a tool call's arguments,
 * which can be a command or a path.
 */
const activity = computed(() => {
  if (isFinished.value)
    return 'Finished'
  if (props.agent.working)
    return workActivity(props.agent).label
  const last = props.agent.currentAction || props.agent.lastTools?.at(-1)?.name
  return last ? `Last tool ${last}` : 'No tool used yet'
})

const facts = computed(() => {
  const list: string[] = []
  if (props.agent.spawnerName)
    list.push(props.agent.spawnerName)
  const subagents = (props.agent.subagents ?? []).filter(s => s.status === 'active').length
  if (subagents > 0)
    list.push(`${subagents} ${subagents === 1 ? 'subagent' : 'subagents'}`)
  list.push(formatRelativeActivity(secondsSince(props.agent.lastActivity, nowMs.value)))
  return list
})

const attentionChip = computed(() => {
  if (!props.attention)
    return null
  return props.attention.level === 'failed'
    ? { word: 'Failed', tone: 'text-danger-text border-danger-line' }
    : { word: 'Needs you', tone: 'text-warning-text border-warning-line' }
})

const showMetrics = ref(false)
const arming = ref(false)
// Arming is per session and lives on the bridge, not in the client: the hook
// asks the server on every gated tool call, and the server has to know before
// the card is even on screen.
async function toggleArmed() {
  arming.value = true
  try {
    const res = await fetch('/api/hooks/permission/arm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: props.agent.sessionId, armed: !props.agent.permissionBridgeArmed }),
    })
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
  }
  catch (e) {
    toast.error(`Could not change interception: ${e instanceof Error ? e.message : String(e)}`)
  }
  finally {
    arming.value = false
  }
}

// The live terminal is reached from the card, so the modal stays a place to
// read and reply. xterm.js is ~490KB — keep it in its own chunk, loaded on first open.
const showTerminal = ref(false)
const AgentTerminal = defineAsyncComponent(() => import('./AgentTerminal.vue'))
</script>

<template>
  <AppCard
    surface="card"
    radius="lg"
    interactive
    class="group relative flex flex-col min-w-0 cursor-pointer"
    data-testid="agent-card"
    :data-attention="attention?.level"
    @click="emit('select', agent)"
  >
    <div class="flex flex-col gap-1.5 px-3 py-2.5 min-w-0">
      <!-- State, attention, name. -->
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          data-testid="agent-card-open"
          :aria-label="`Open details for ${title}`"
          class="flex items-center gap-2 min-w-0 flex-1 bg-transparent border-none p-0 text-left cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          @click.stop="emit('select', agent)"
        >
          <AppBadge :variant="displayStatus" :title="statusBadgeTitle" />
          <span
            v-if="attentionChip"
            data-testid="agent-card-attention"
            class="shrink-0 rounded-control border bg-card px-1.5 py-px text-label font-semibold uppercase tracking-wide whitespace-nowrap"
            :class="attentionChip.tone"
            :title="attention?.reason"
          >{{ attentionChip.word }}<span class="sr-only">: {{ attention?.reason }}</span></span>
          <AppBadge
            v-if="agent.internalProcess"
            variant="info"
            label="internal"
            title="Claude Code's own internal daemon process — not a session you can message"
            data-testid="agent-card-internal-badge"
          />
          <span
            v-if="awaitingInput"
            data-testid="agent-awaiting-input"
            class="shrink-0 rounded-control bg-neutral-soft px-1 py-px text-label font-medium text-neutral-text whitespace-nowrap"
            title="The agent finished its turn — it will not do anything else until you send it something"
          >your turn</span>
          <span class="shrink-0" aria-hidden="true">{{ getIdentity(agent.projectPath).emoji }}</span>
          <span class="min-w-0 truncate text-ui font-semibold text-fg" data-testid="agent-card-title" :title="title">{{ title }}</span>
        </button>
        <ProviderBadge :provider="agent.provider" />
        <span
          class="shrink-0 whitespace-nowrap font-mono text-label text-fg-mute"
          :title="agent.model ? `Model: ${agent.model}` : 'Model unknown'"
        >{{ shortModel(agent.model ?? null) }}</span>
        <MachineBadge v-if="agent.machine" :machine="agent.machine" />
      </div>

      <!-- Where: repository and workspace, by identity. Never a folder path. -->
      <div class="flex items-center gap-1.5 min-w-0 text-ui-sm text-fg-mute" data-testid="agent-card-where">
        <template v-if="agent.workspace">
          <span
            v-if="agent.workspace.repository"
            class="min-w-0 max-w-[45%] truncate font-mono text-fg-soft"
            data-testid="agent-card-repository"
            :title="`Repository ${agent.workspace.repository.name || ''}`.trim()"
          >{{ agent.workspace.repository.name || 'Repository' }}</span>
          <span v-else class="min-w-0 truncate font-mono text-fg-soft" data-testid="agent-card-local-workspace">
            {{ agent.workspace.name }} <span class="font-sans text-fg-faint">local</span>
          </span>
          <WorkspaceBadge :workspace="agent.workspace" class="min-w-[4.5rem] max-w-[14rem]" />
        </template>
        <span v-else class="text-fg-faint" data-testid="agent-card-workspace-unknown">Workspace unknown</span>
        <!-- Runtime observed by LocalScope in this agent's workspace; nothing when there is none. -->
        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          <AgentServiceChips :agent="agent" />
        </span>
      </div>

      <!-- Doing, and the actions. -->
      <div class="flex items-center gap-2 min-w-0 text-ui-sm text-fg-mute" data-testid="agent-card-body">
        <span class="min-w-0 truncate text-fg-soft" data-testid="agent-card-activity">{{ activity }}</span>
        <span class="min-w-0 truncate" data-testid="agent-card-facts">· {{ facts.join(' · ') }}</span>

        <span class="ml-auto flex shrink-0 items-center gap-1">
          <span class="font-mono tabular-nums text-fg-soft" data-testid="agent-card-cost" title="Estimated session cost">
            <span v-if="agent.costUnknown" title="Cost unknown — no pricing data for this provider/model">?</span>
            <template v-else>{{ formatCost(agent.costEstimate) }}</template>
          </span>
          <span
            class="relative z-10"
            @mouseenter="showMetrics = true"
            @mouseleave="showMetrics = false"
            @focusin="showMetrics = true"
            @focusout="showMetrics = false"
          >
            <button
              type="button"
              class="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-ui-sm leading-none text-fg-mute hover:text-fg-soft focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Show more metrics"
              data-testid="agent-card-info"
              @click.stop="showMetrics = !showMetrics"
            >ⓘ</button>
            <MetricsPopover v-if="showMetrics" :agent="agent" @click.stop />
          </span>
          <button
            v-if="agent.liveInjectable"
            type="button"
            class="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-ui-sm leading-none text-fg-mute hover:text-fg-soft focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Open terminal"
            title="Open the live terminal for this session"
            data-testid="agent-card-terminal"
            @click.stop="showTerminal = true"
          >⌨</button>
          <button
            v-if="!isFinished"
            type="button"
            class="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-ui-sm leading-none focus-visible:outline-2 focus-visible:outline-ring"
            :class="agent.permissionBridgeArmed ? 'text-warning-text' : 'text-fg-mute hover:text-fg-soft'"
            :aria-pressed="agent.permissionBridgeArmed ? 'true' : 'false'"
            :aria-label="agent.permissionBridgeArmed
              ? 'Stop answering this session\'s permission prompts here'
              : 'Answer this session\'s permission prompts here instead of in its terminal'"
            :title="agent.permissionBridgeArmed
              ? 'Permission prompts from this session are answered here. Click to hand them back to its terminal.'
              : 'Answer this session\'s permission prompts here instead of in its terminal. Requires the hooks to be installed.'"
            :disabled="arming"
            data-testid="agent-card-arm-permissions"
            @click.stop="toggleArmed"
          >{{ agent.permissionBridgeArmed ? '🔒' : '🔓' }}</button>
          <button
            v-if="isFinished"
            type="button"
            class="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-sm leading-none text-fg-mute hover:text-danger-text focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Dismiss finished agent"
            data-testid="agent-card-dismiss"
            @click.stop="dismiss"
          >✕</button>
        </span>
      </div>
    </div>

    <div
      v-if="!agent.machine"
      class="shrink-0 max-h-0 opacity-0 overflow-hidden transition-[max-height,opacity] duration-150 ease-out group-hover:max-h-40 group-hover:opacity-100 focus-within:max-h-40 focus-within:opacity-100"
      @click.stop
      @keydown.enter.stop
      @keydown.space.stop
    >
      <PromptInput :agent="agent" variant="compact" />
    </div>

    <AppModal
      :open="showTerminal"
      :z-index="1100"
      :labelled-by="`agent-terminal-title-${agent.sessionId}`"
      @close="showTerminal = false"
    >
      <div class="bg-raised px-4 py-2.5 flex justify-between items-center flex-shrink-0" @click.stop>
        <span :id="`agent-terminal-title-${agent.sessionId}`" class="font-semibold text-sm text-fg">
          Terminal — {{ title }}
        </span>
        <button
          type="button"
          aria-label="Close terminal"
          class="bg-transparent border-none text-fg-mute text-base cursor-pointer px-2 py-1 rounded hover:bg-raised hover:text-fg"
          @click.stop="showTerminal = false"
        >
          ✕
        </button>
      </div>
      <div data-testid="agent-terminal-modal" class="flex-1 min-h-0" @click.stop>
        <AgentTerminal v-if="showTerminal" :key="agent.pid" :pid="agent.pid" />
      </div>
    </AppModal>
  </AppCard>
</template>
