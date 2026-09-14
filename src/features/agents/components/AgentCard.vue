<script setup lang="ts">
import type { AttentionItem } from '@/features/attention'
import type { Agent } from '@/types'
import { computed, defineAsyncComponent, ref } from 'vue'
import MachineBadge from '@/components/MachineBadge.vue'
import ProviderBadge from '@/components/ProviderBadge.vue'
import AgentGlyph from '@/components/ui/AgentGlyph.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppModal from '@/components/ui/AppModal.vue'
import WorkspaceBadge from '@/components/ui/WorkspaceBadge.vue'
import { agentIsRunning, editorLabel, openInEditor, useAgentLifecycle } from '@/composables/useAgentLifecycle'
import { useNow } from '@/composables/useNow'
import { toast } from '@/composables/useToast'
import AgentServiceChips from '@/features/agents/components/AgentServiceChips.vue'
import MetricsPopover from '@/features/agents/components/MetricsPopover.vue'
import { useMetricsDisclosure } from '@/features/agents/composables/useMetricsDisclosure'
import { agentKind } from '@/utils/agentCategory'
import { agentActivity, agentTechnical, agentTitle, agentTopic, workActivity } from '@/utils/agentLabels'
import { formatCost, formatRelativeActivity, formatUptime, isAwaitingInput, secondsSince, shortModel, totalTokenCount } from '@/utils/format'
import { agentDisplayStatus } from '@/utils/statusColors'

/*
 * An agent as a compact operational dashboard (3N.2): three to a row on a
 * desktop, every figure on it real.
 *
 *   WHO        purpose icon · name · state · last activity · technical handle
 *   WHAT       what it is doing now · the session's topic
 *   WHERE      repository and workspace · services observed in it
 *   INSTRUMENTS  uptime · recent tool calls · tokens · estimated cost
 *   TOOL MIX   the recent tool calls by tool, as a bar with its numbers in words
 *   FACTS      model, files changed and lines (when Claude wrote session meta),
 *              subagents, role
 *   NEEDS YOU  the canonical attention item's reason, with Review
 *   ACTIONS    Open · Open in the editor · terminal · metrics · permissions
 *              · Stop · Delete (destructive, set apart)
 *
 * Deliberately absent, because the data does not exist or must not be here:
 * per-agent CPU and memory (no reliable attribution), activity sparklines (no
 * history is kept), tags, file names, commands, tool arguments, the transcript,
 * the PID and the working folder path — the editor link reads the path only on
 * click, so it never sits in this markup.
 *
 * Motion (ANIMATION = INFORMATION): the card never moves as a whole. Its top
 * edge is the only moving part, and only while the evidence is live —
 *
 *   working    the edge breathes and a faint highlight travels along it
 *   tool       a brighter segment sweeps the edge (a tool call is open)
 *   needs you  amber frame and edge, still; the chip rings once on arrival
 *   failed     red frame and edge, still
 *   otherwise  quiet, neutral frame
 *
 * While agent updates reconnect (`stale`) nothing moves.
 */
const props = defineProps<{
  agent: Agent
  /** This agent's canonical attention item, when it has one. */
  attention?: AttentionItem | null
  /** Last-known state while agent updates reconnect: shown, but still. */
  stale?: boolean
}>()
const emit = defineEmits<{ select: [agent: Agent] }>()

const { nowMs } = useNow()
const { requestStop, requestDelete } = useAgentLifecycle()

const isFinished = computed(() => props.agent.status === 'finished')
const running = computed(() => agentIsRunning(props.agent) && !props.agent.machine && !props.agent.internalProcess)
const displayStatus = computed(() => agentDisplayStatus(props.agent))
const statusBadgeTitle = computed(() => displayStatus.value === 'waiting'
  ? 'No new activity for a bit — the agent process is still alive, not waiting on you'
  : undefined)

const title = computed(() => agentTitle(props.agent))
const technical = computed(() => agentTechnical(props.agent))
const launch = computed(() => agentKind(props.agent).label)
const topic = computed(() => agentTopic(props.agent))
const activity = computed(() => agentActivity(props.agent))
const awaitingInput = computed(() => isAwaitingInput(props.agent))
const since = computed(() => formatRelativeActivity(secondsSince(props.agent.lastActivity, nowMs.value)))

/* Instruments: each shown only from a real value. */
// Sessions reach billions of tokens (cache reads count); "1977.25M" is unreadable.
function tokenLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0)
    return '—'
  if (n >= 1e9)
    return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6)
    return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3)
    return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}
const toolCalls = computed(() => Object.values(props.agent.toolCounts ?? {}).reduce((n, c) => n + (Number.isFinite(c) ? c : 0), 0))
const instruments = computed(() => [
  {
    key: 'uptime',
    label: 'Uptime',
    value: !isFinished.value && props.agent.uptime > 0 ? formatUptime(props.agent.uptime) : '—',
    title: 'How long the agent process has been running',
  },
  {
    key: 'tools',
    label: 'Tool calls',
    value: toolCalls.value > 0 ? String(toolCalls.value) : '—',
    title: 'Tool calls in the recent part of the session log',
  },
  {
    key: 'tokens',
    label: 'Tokens',
    value: tokenLabel(totalTokenCount(props.agent.tokenUsage)),
    title: 'Tokens used by the whole session',
  },
  {
    key: 'cost',
    label: 'Est. cost',
    value: props.agent.costUnknown ? 'Unknown' : formatCost(props.agent.costEstimate),
    title: props.agent.costUnknown ? 'No pricing data for this provider or model' : 'Estimated API-equivalent cost of the whole session',
  },
])

/*
 * The recent tool calls by tool: a bar, with the same numbers in words. Only
 * when there are at least two tools — a one-segment bar is a full stripe that
 * says nothing the number beside it does not.
 */
const MIX_SHADES = ['bg-fg-mute/80', 'bg-fg-faint/70', 'bg-line-strong', 'bg-raised']
const toolMix = computed(() => {
  const entries = Object.entries(props.agent.toolCounts ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  const total = toolCalls.value
  if (entries.length < 2 || total === 0)
    return null
  const top = entries.slice(0, 3)
  const rest = entries.slice(3).reduce((n, [, c]) => n + c, 0)
  const segments = top.map(([name, count], i) => ({ name, count, pct: (count / total) * 100, shade: MIX_SHADES[i] }))
  if (rest > 0)
    segments.push({ name: 'other', count: rest, pct: (rest / total) * 100, shade: MIX_SHADES[3] })
  return { total, segments, text: segments.map(s => `${s.name} ${s.count}`).join(' · ') }
})

/* Facts that exist only when the data does. */
const chips = computed(() => {
  const list: { key: string, text: string, title?: string, mono?: boolean }[] = []
  if (props.agent.model)
    list.push({ key: 'model', text: shortModel(props.agent.model), title: `Model: ${props.agent.model}`, mono: true })
  const meta = props.agent.meta
  if (meta && meta.filesModified > 0)
    list.push({ key: 'files', text: `${meta.filesModified} ${meta.filesModified === 1 ? 'file' : 'files'} changed` })
  if (meta && (meta.linesAdded > 0 || meta.linesRemoved > 0))
    list.push({ key: 'lines', text: `+${meta.linesAdded} −${meta.linesRemoved}`, title: 'Lines added and removed', mono: true })
  if (meta && meta.gitCommits > 0)
    list.push({ key: 'commits', text: `${meta.gitCommits} ${meta.gitCommits === 1 ? 'commit' : 'commits'}` })
  return list
})

const facts = computed(() => {
  const list: string[] = []
  if (props.agent.spawnerName)
    list.push(props.agent.spawnerName)
  const subagents = (props.agent.subagents ?? []).filter(s => s.status === 'active').length
  if (subagents > 0)
    list.push(`${subagents} ${subagents === 1 ? 'subagent' : 'subagents'}`)
  return list
})

const attentionChip = computed(() => {
  if (!props.attention)
    return null
  return props.attention.level === 'failed'
    ? { word: 'Failed', tone: 'text-danger-text border-danger-line', motion: '' }
    : { word: 'Needs you', tone: 'text-warning-text border-warning-line', motion: props.stale ? '' : 'motion-arrive-attention' }
})

type Signal = 'working' | 'tool' | 'attention' | 'failed' | 'rest'

const signal = computed<Signal>(() => {
  if (props.attention?.level === 'failed')
    return 'failed'
  if (props.attention)
    return 'attention'
  if (props.agent.working && !isFinished.value)
    return workActivity(props.agent).state
  return 'rest'
})

const EDGE: Record<Signal, { bar: string, motion: string, frame: string }> = {
  working: { bar: 'bg-state-working/60', motion: 'motion-working', frame: 'cc-frame-working' },
  tool: { bar: 'bg-state-tool/35', motion: '', frame: 'cc-frame-working' },
  attention: { bar: 'bg-state-waiting', motion: '', frame: 'cc-frame-attention' },
  failed: { bar: 'bg-state-error', motion: '', frame: 'cc-frame-failed' },
  rest: { bar: '', motion: '', frame: '' },
}
const edge = computed(() => EDGE[signal.value])

const metrics = useMetricsDisclosure()
const metricsOpen = metrics.open
const arming = ref(false)
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

const canOpenEditor = computed(() => !props.agent.machine && !!props.agent.cwd)
const editor = editorLabel()

// xterm.js is ~490KB — its own chunk, loaded on first open.
const showTerminal = ref(false)
const AgentTerminal = defineAsyncComponent(() => import('./AgentTerminal.vue'))

const ICON_BUTTON = 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-ui-sm leading-none text-fg-mute transition-colors duration-[var(--duration-fast)] ease-standard hover:border-line hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent'
</script>

<template>
  <article
    class="cc-card group relative flex min-w-0 cursor-pointer flex-col rounded-xl border"
    :class="[edge.frame || 'border-line hover:border-line-strong']"
    data-testid="agent-card"
    :data-attention="attention?.level"
    :data-signal="signal"
    @click="emit('select', agent)"
  >
    <!-- The edge: the one part of a card that may move. -->
    <span
      v-if="signal !== 'rest'"
      class="pointer-events-none absolute inset-x-5 top-0 h-px overflow-hidden rounded-full"
      :class="[edge.bar, stale ? '' : edge.motion]"
      data-testid="agent-card-edge"
      aria-hidden="true"
    >
      <span v-if="signal === 'tool' && !stale" class="motion-sweep block h-full w-1/3 bg-state-tool" data-testid="agent-card-sweep" />
      <span v-else-if="signal === 'working' && !stale" class="motion-energy cc-energy block h-full w-1/4" data-testid="agent-card-energy" />
    </span>

    <!-- WHO -->
    <div class="flex items-start gap-3 px-4 pt-4">
      <AgentGlyph :agent="agent" size="lg" />
      <button
        type="button"
        data-testid="agent-card-open"
        :aria-label="`Open details for ${title}`"
        class="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded border-none bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        @click.stop="emit('select', agent)"
      >
        <span class="w-full min-w-0 truncate text-body font-semibold leading-tight text-fg" data-testid="agent-card-title" :title="title">{{ title }}</span>
        <span class="flex max-w-full min-w-0 items-center gap-2 text-ui-sm">
          <AppBadge :variant="displayStatus" :title="statusBadgeTitle" :still="stale" />
          <span class="truncate text-fg-faint" data-testid="agent-card-since">{{ since }}</span>
        </span>
      </button>
      <span class="flex shrink-0 flex-col items-end gap-1.5">
        <span
          v-if="technical"
          class="rounded-md border border-line bg-raised/60 px-1.5 py-0.5 font-mono text-label text-fg-mute"
          :title="launch"
          data-testid="agent-card-technical"
        >{{ technical }}</span>
        <span
          v-if="attentionChip"
          data-testid="agent-card-attention"
          class="rounded-control border bg-card px-1.5 py-px text-label font-semibold uppercase tracking-wide whitespace-nowrap"
          :class="[attentionChip.tone, attentionChip.motion]"
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
          class="rounded-control bg-neutral-soft px-1 py-px text-label font-medium whitespace-nowrap text-neutral-text"
          title="The agent finished its turn — it will not do anything else until you send it something"
        >your turn</span>
      </span>
    </div>

    <div class="flex flex-1 flex-col gap-3 px-4 pt-3 pb-3">
      <!-- WHAT -->
      <p class="m-0 flex min-w-0 items-baseline gap-1.5 text-ui" data-testid="agent-card-body">
        <span
          class="shrink-0"
          :class="signal === 'working' || signal === 'tool' ? 'font-medium text-state-working' : 'text-fg-soft'"
          data-testid="agent-card-activity"
        >{{ activity }}</span>
        <span v-if="topic" class="min-w-0 truncate text-fg-soft" :title="topic" data-testid="agent-card-topic">· {{ topic }}</span>
      </p>

      <!-- WHERE: repository and workspace, by identity. Never a folder path. -->
      <div class="flex min-w-0 items-center gap-1.5 text-ui-sm text-fg-mute" data-testid="agent-card-where">
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
        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          <AgentServiceChips :agent="agent" />
        </span>
      </div>

      <!-- INSTRUMENTS -->
      <dl class="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line @min-[22rem]:grid-cols-4" data-testid="agent-card-instruments">
        <div v-for="i in instruments" :key="i.key" class="flex min-w-0 flex-col gap-0.5 bg-card/95 px-2.5 py-2" :title="i.title">
          <dt class="text-label uppercase tracking-wider text-fg-faint">
            {{ i.label }}
          </dt>
          <dd
            class="m-0 truncate font-mono text-ui font-semibold tabular-nums text-fg"
            :data-testid="i.key === 'cost' ? 'agent-card-cost' : `agent-card-${i.key}`"
          >
            {{ i.value }}
          </dd>
        </div>
      </dl>

      <!-- TOOL MIX -->
      <div v-if="toolMix" class="flex flex-col gap-1" data-testid="agent-card-tool-mix">
        <span class="h-1 w-full overflow-hidden rounded-full bg-raised/60" aria-hidden="true">
          <span class="flex h-full w-full">
            <span v-for="s in toolMix.segments" :key="s.name" class="h-full" :class="s.shade" :style="{ width: `${s.pct}%` }" />
          </span>
        </span>
        <p class="m-0 truncate text-label text-fg-mute">
          <span class="sr-only">Recent tool calls by tool: </span>{{ toolMix.text }}
        </p>
      </div>

      <!-- FACTS -->
      <ul v-if="chips.length || facts.length || agent.machine" class="m-0 flex list-none flex-wrap items-center gap-1.5 p-0" data-testid="agent-card-chips">
        <li v-for="c in chips" :key="c.key" class="rounded-md border border-line bg-raised/50 px-2 py-0.5 text-label text-fg-soft" :class="c.mono ? 'font-mono' : ''" :title="c.title">
          {{ c.text }}
        </li>
        <li v-if="facts.length" class="text-label text-fg-mute" data-testid="agent-card-facts">
          {{ facts.join(' · ') }}
        </li>
        <li class="contents">
          <ProviderBadge :provider="agent.provider" />
          <MachineBadge v-if="agent.machine" :machine="agent.machine" />
        </li>
      </ul>
    </div>

    <!-- NEEDS YOU: the canonical item's reason, and where it is dealt with. -->
    <div
      v-if="attention"
      class="mx-4 mb-3 flex items-center gap-3 rounded-lg border px-3 py-2"
      :class="attention.level === 'failed' ? 'border-danger-line bg-danger-soft' : 'border-warning-line bg-warning-soft'"
      data-testid="agent-card-attention-panel"
    >
      <span class="min-w-0 flex-1">
        <span class="block text-ui-sm font-semibold" :class="attention.level === 'failed' ? 'text-danger-text' : 'text-warning-text'">
          {{ attention.level === 'failed' ? 'Failed' : 'Needs your decision' }}
        </span>
        <span class="block truncate text-ui-sm text-fg-soft">{{ attention.reason }}</span>
      </span>
      <button
        type="button"
        class="shrink-0 cursor-pointer rounded-lg border border-line-strong bg-card px-3 py-1 text-ui-sm font-medium text-fg hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        data-testid="agent-card-review"
        @click.stop="emit('select', agent)"
      >
        Review
      </button>
    </div>

    <!-- ACTIONS: everyday on the left, destructive set apart on the right. -->
    <div class="flex items-center gap-1.5 border-t border-line px-3 py-2" data-testid="agent-card-actions" @click.stop>
      <button
        type="button"
        class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line bg-raised/50 px-3 text-ui-sm font-medium text-fg hover:border-line-strong hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        data-testid="agent-card-open-button"
        :aria-label="`Open ${title}`"
        @click="emit('select', agent)"
      >
        Open
      </button>
      <button
        v-if="canOpenEditor"
        type="button"
        class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-transparent px-2.5 text-ui-sm text-accent hover:border-line hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        data-testid="agent-card-editor"
        @click="openInEditor(agent.cwd)"
      >
        Open in {{ editor }}
      </button>
      <button
        v-if="agent.liveInjectable"
        type="button"
        :class="ICON_BUTTON"
        aria-label="Open terminal"
        title="Open the live terminal for this session"
        data-testid="agent-card-terminal"
        @click="showTerminal = true"
      >
        ⌨
      </button>
      <span
        class="relative z-10"
        data-testid="agent-card-metrics"
        @mouseenter="metrics.onPointerEnter"
        @mouseleave="metrics.onPointerLeave"
        @focusin="metrics.onFocusIn"
        @focusout="metrics.onFocusOut"
        @keydown.escape="metrics.onEscape"
      >
        <button
          type="button"
          :class="ICON_BUTTON"
          aria-label="Show more metrics"
          :aria-expanded="metricsOpen"
          data-testid="agent-card-info"
          @click="metrics.toggle"
        >ⓘ</button>
        <MetricsPopover v-if="metricsOpen" :agent="agent" @click.stop />
      </span>
      <button
        v-if="!isFinished"
        type="button"
        :class="[ICON_BUTTON, agent.permissionBridgeArmed ? 'text-warning-text' : '']"
        :aria-pressed="agent.permissionBridgeArmed ? 'true' : 'false'"
        :aria-label="agent.permissionBridgeArmed
          ? 'Stop answering this session\'s permission prompts here'
          : 'Answer this session\'s permission prompts here instead of in its terminal'"
        :title="agent.permissionBridgeArmed
          ? 'Permission prompts from this session are answered here. Click to hand them back to its terminal.'
          : 'Answer this session\'s permission prompts here instead of in its terminal. Requires the hooks to be installed.'"
        :disabled="arming"
        data-testid="agent-card-arm-permissions"
        @click="toggleArmed"
      >
        {{ agent.permissionBridgeArmed ? '🔒' : '🔓' }}
      </button>

      <span class="ml-auto flex items-center gap-1.5">
        <button
          v-if="running"
          type="button"
          class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-danger-line/70 px-2.5 text-ui-sm font-medium text-danger-text hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
          data-testid="agent-card-stop"
          :aria-label="`Stop ${title}`"
          @click="requestStop(agent)"
        >
          <span class="size-2 rounded-[2px] bg-danger-text" aria-hidden="true" />Stop
        </button>
        <button
          v-if="!agent.internalProcess && !agent.machine"
          type="button"
          class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line text-fg-mute hover:border-danger-line hover:bg-danger-soft hover:text-danger-text focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
          data-testid="agent-card-delete"
          :aria-label="`Delete ${title} from Agent Dashboard`"
          title="Delete agent — your files are kept"
          @click="requestDelete(agent)"
        >
          <svg viewBox="0 0 16 16" class="size-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true" focusable="false">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
          </svg>
        </button>
      </span>
    </div>

    <AppModal
      :open="showTerminal"
      :z-index="1100"
      :labelled-by="`agent-terminal-title-${agent.sessionId}`"
      @close="showTerminal = false"
    >
      <div class="flex flex-shrink-0 items-center justify-between bg-raised px-4 py-2.5" @click.stop>
        <span :id="`agent-terminal-title-${agent.sessionId}`" class="text-sm font-semibold text-fg">
          Terminal — {{ title }}
        </span>
        <button
          type="button"
          aria-label="Close terminal"
          class="cursor-pointer rounded border-none bg-transparent px-2 py-1 text-base text-fg-mute hover:bg-raised hover:text-fg"
          @click.stop="showTerminal = false"
        >
          ✕
        </button>
      </div>
      <div data-testid="agent-terminal-modal" class="min-h-0 flex-1" @click.stop>
        <AgentTerminal v-if="showTerminal" :key="agent.pid" :pid="agent.pid" />
      </div>
    </AppModal>
  </article>
</template>
