<script setup lang="ts">
import type { Agent, OutputMessage, SubAgent } from '@/types'
import { computed, nextTick, ref, watch } from 'vue'
import CrossLinkBanner from '@/components/CrossLinkBanner.vue'
import HookEventList from '@/components/HookEventList.vue'
import MachineBadge from '@/components/MachineBadge.vue'
import PromptInput from '@/components/PromptInput.vue'
import TaskList from '@/components/TaskList.vue'
import ToolTimeline from '@/components/ToolTimeline.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { usePermissionResolve } from '@/composables/usePermissionResolve'
import { toast } from '@/composables/useToast'
import { useAgentIdentity } from '@/features/agents/composables/useAgentIdentity'
import { PluginSlot } from '@/features/plugins'
import { formatCost, formatTokens, formatUptime, shortModel, totalTokenCount } from '@/utils/format'
import { agentDisplayStatus } from '@/utils/statusColors'
import AgentChatStream from './AgentChatStream.vue'
import MetricsPopover from './MetricsPopover.vue'
import SubAgentList from './SubAgentList.vue'

const props = defineProps<{ agent: Agent | null }>()

const emit = defineEmits<{ close: [], navigate: [taskId: string] }>()

const localMessages = ref<OutputMessage[]>([])
const promptInputRef = ref<InstanceType<typeof PromptInput> | null>(null)
const chatStreamRef = ref<InstanceType<typeof AgentChatStream> | null>(null)
const showMetrics = ref(false)

/*
 * Tabs. Deliberately two, not the four in the reference design:
 *
 * - "Files" would need a per-agent file list. `meta` carries only counts
 *   (filesModified / linesAdded / linesRemoved) and no endpoint returns paths,
 *   so the tab could only be populated by inventing them.
 * - "Settings" would need per-agent configuration. Spawners are global and an
 *   agent has no editable fields, so there is nothing to put there.
 *
 * Both are omitted rather than shipped empty.
 */
type PanelTab = 'overview' | 'transcript'
const activeTab = ref<PanelTab>('transcript')
const TABS: { value: PanelTab, label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'transcript', label: 'Transcript' },
]

/*
 * TodoWrite items the session wrote, used as genuine task progress. These are
 * NOT phases: the count is whatever the agent last wrote, so labelling them
 * "Phase 3/7" would imply a fixed pipeline that does not exist. A real phase
 * number is only available for a pipeline-linked agent (pipelineTaskId).
 */
const taskProgress = computed(() => {
  const tasks = props.agent?.tasks ?? []
  if (tasks.length === 0)
    return null
  const done = tasks.filter(t => t.status === 'completed').length
  return { done, total: tasks.length, pct: Math.round((done / tasks.length) * 100) }
})

/*
 * Whether a typed message can actually reach this session. `liveInjectable`
 * means a pty broker or tmux backing exists; without it PromptInput falls back
 * to resuming the session, which is a different and heavier action. Sessions on
 * a remote machine cannot be reached from here at all.
 */
const canMessage = computed(() => !!props.agent && !props.agent.machine)

const hasContext = computed(() => {
  const a = props.agent
  if (!a)
    return false
  return a.tasks.length > 0 || a.subagents.length > 0 || a.lastTools.length > 0 || (a.recentHookEvents?.length ?? 0) > 0
})

// A subagent opened from the context panel takes over the transcript area; the
// modal otherwise belongs to its parent agent. Switching agents drops it, or the
// next session would open on someone else's subagent.
const openSubagent = ref<SubAgent | null>(null)
watch(() => props.agent?.sessionId, () => {
  openSubagent.value = null
})

const { getIdentity } = useAgentIdentity()
const { resolveAgent } = usePermissionResolve()

const totalTokens = computed(() => props.agent ? totalTokenCount(props.agent.tokenUsage) : 0)

async function handleApprove() {
  if (!props.agent)
    return
  const err = await resolveAgent(props.agent, 'granted')
  if (err)
    toast.error(err)
}

const approveHandler = computed(() =>
  props.agent?.pipelineTaskId && props.agent?.pendingPermissions?.length
    ? handleApprove
    : null,
)

function onMessageSent(msg: OutputMessage) {
  localMessages.value.push(msg)
  nextTick(() => chatStreamRef.value?.scrollToBottom())
}

// Reset local messages when the agent changes, focus prompt input
watch(() => props.agent?.sessionId, (sessionId) => {
  localMessages.value = []
  if (sessionId && !props.agent?.machine)
    nextTick(() => promptInputRef.value?.focus())
})

// Escape is handled by AppModal's @keydown.escape on its backdrop — no window listener needed.
</script>

<template>
  <AppModal
    :open="!!agent"
    :z-index="1000"
    size="auto"
    placement="end"
    :labelled-by="agent ? `agent-modal-title-${agent.pid}` : undefined"
    @close="emit('close')"
  >
    <!--
      Side drawer rather than a centred dialog: selecting an agent should not
      cover the roster it was selected from. Full height, capped width, and it
      falls back to the full viewport width on small screens.
    -->
    <div
      v-if="agent"
      data-testid="agent-details-panel"
      class="w-screen sm:w-[min(560px,100vw)] h-full bg-card border-l border-line shadow-modal flex flex-col overflow-hidden"
    >
      <!-- Two rows: the drawer is narrower than the old centred dialog, so the
           metrics line sits under the identity rather than wrapping through it. -->
      <div class="bg-raised px-4 py-2.5 flex flex-col gap-1.5 flex-shrink-0">
        <div class="flex items-center gap-2.5 min-w-0">
          <AppBadge :variant="agentDisplayStatus(agent)" />
          <span aria-hidden="true">{{ getIdentity(agent.projectPath).emoji }}</span>
          <span :id="`agent-modal-title-${agent.pid}`" class="font-semibold text-sm text-fg truncate">{{ agent.projectName }}</span>
          <MachineBadge v-if="agent.machine" :machine="agent.machine" />
          <button
            type="button"
            aria-label="Close"
            class="ml-auto shrink-0 bg-transparent border-none text-fg-mute text-base cursor-pointer px-2 py-1 rounded hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-[11px] font-mono text-fg-mute truncate">{{ shortModel(agent.model ?? null) }} · {{ formatCost(agent.costEstimate) }} · {{ formatTokens(totalTokens) }} tok · {{ formatUptime(agent.uptime) }}</span>
          <!-- The breakdown behind the same affordance the card uses, instead of a
               token table nested two levels deep in a drawer. -->
          <span
            class="relative shrink-0"
            @mouseenter="showMetrics = true"
            @mouseleave="showMetrics = false"
            @focusin="showMetrics = true"
            @focusout="showMetrics = false"
          >
            <button
              type="button"
              class="inline-flex items-center justify-center min-w-6 min-h-6 text-fg-mute hover:text-fg-soft text-[11px] leading-none rounded focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Show token and cost breakdown"
              data-testid="agent-modal-metrics"
              @click="showMetrics = !showMetrics"
            >ⓘ</button>
            <MetricsPopover v-if="showMetrics" :agent="agent" />
          </span>
        </div>
      </div>

      <!-- Tabs are hidden while a subagent transcript is open: that view has its
           own back affordance and belongs to neither tab. -->
      <div
        v-if="!openSubagent"
        class="flex items-center gap-1 px-3 border-b border-line flex-shrink-0"
        role="tablist"
        aria-label="Agent detail sections"
      >
        <button
          v-for="t in TABS"
          :key="t.value"
          type="button"
          role="tab"
          :aria-selected="activeTab === t.value"
          :tabindex="activeTab === t.value ? 0 : -1"
          :data-testid="`agent-tab-${t.value}`"
          class="px-3 h-8 text-[12px] border-b-2 -mb-px transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent rounded-t"
          :class="activeTab === t.value
            ? 'border-accent text-accent font-semibold'
            : 'border-transparent text-fg-mute hover:text-fg'"
          @click="activeTab = t.value"
        >
          {{ t.label }}
        </button>
      </div>
      <CrossLinkBanner
        v-if="agent.pipelineTaskId"
        label="Part of"
        :target-name="agent.pipelineTaskTitle ?? `Task ${agent.pipelineTaskId.slice(0, 8)}`"
        button-text="Open →"
        @click="emit('navigate', agent.pipelineTaskId)"
      />
      <template v-if="openSubagent">
        <div class="flex items-center gap-2 px-4 py-2 border-b border-line text-xs flex-shrink-0">
          <button
            type="button"
            class="text-accent hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent rounded px-1"
            data-testid="subagent-back"
            @click="openSubagent = null"
          >
            ← Back to session
          </button>
          <span class="font-mono text-fg-mute">Subagent {{ openSubagent.id.substring(0, 16) }}</span>
          <AppBadge :variant="openSubagent.status" />
        </div>
        <AgentChatStream
          :agent="null"
          :session-id="openSubagent.id"
          data-testid="subagent-transcript"
          class="flex-1 min-h-0 overflow-y-auto p-4"
        />
      </template>
      <template v-else-if="activeTab === 'overview'">
        <div data-testid="agent-overview-tab" class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <dt class="text-fg-faint">
              Project
            </dt>
            <dd class="font-mono text-fg-soft truncate" :title="agent.projectPath">
              {{ agent.projectPath }}
            </dd>
            <dt class="text-fg-faint">
              Session
            </dt>
            <dd class="font-mono text-fg-soft truncate">
              {{ agent.sessionId }}
            </dd>
            <dt class="text-fg-faint">
              Process
            </dt>
            <dd class="font-mono text-fg-soft">
              pid {{ agent.pid }} · {{ agent.provider }}
            </dd>
            <dt class="text-fg-faint">
              Spawner
            </dt>
            <dd class="font-mono text-fg-soft truncate">
              {{ agent.spawnerName ?? '—' }}
            </dd>
            <dt class="text-fg-faint">
              Health
            </dt>
            <dd class="font-mono text-fg-soft">
              {{ agent.healthScore }}/100
            </dd>
          </dl>

          <!-- TodoWrite progress, shown only when the session actually wrote
               items. Labelled "Tasks", never "Phase" — see taskProgress. -->
          <div v-if="taskProgress" data-testid="agent-task-progress" class="flex flex-col gap-1.5">
            <div class="flex items-baseline gap-2">
              <span class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">Tasks</span>
              <span class="ml-auto text-[11px] font-mono tabular-nums text-fg-soft">
                {{ taskProgress.done }} / {{ taskProgress.total }} completed
              </span>
            </div>
            <span class="h-1.5 bg-raised rounded-full overflow-hidden">
              <span
                class="block h-full rounded-full bg-accent transition-[width] duration-[var(--duration-base)] ease-standard"
                :style="{ width: `${taskProgress.pct}%` }"
              />
            </span>
          </div>

          <div v-if="agent.currentAction" class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">Current action</span>
            <span class="text-[12px] font-mono text-fg-soft">{{ agent.currentAction }}</span>
          </div>

          <!-- Recent output, terminal-styled. Real transcript text only; the
               full history lives in the Transcript tab. -->
          <div class="flex flex-col gap-1 min-h-0">
            <span class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">Recent output</span>
            <pre
              v-if="agent.lastOutput"
              data-testid="agent-recent-output"
              class="text-[11px] font-mono text-fg-mute bg-app border border-line rounded-md p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
            >{{ agent.lastOutput }}</pre>
            <p v-else class="text-[12px] text-fg-faint italic">
              No output yet
            </p>
          </div>

          <!--
            Actions are limited to what the backend supports. There is no pause
            and no stop endpoint for an agent process, so no such buttons exist
            here; dismissing a finished agent and messaging a reachable one are
            the real capabilities.
          -->
          <div class="flex flex-col gap-1">
            <span class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">Actions</span>
            <p v-if="canMessage" class="text-[11px] text-fg-mute">
              Use the message box below to send this session a prompt.
            </p>
            <p v-else data-testid="agent-unreachable-note" class="text-[11px] text-warning-text">
              This session runs on {{ agent.machine }} and cannot be messaged from here.
            </p>
            <p v-if="!agent.liveInjectable && canMessage" data-testid="agent-resume-note" class="text-[11px] text-fg-faint">
              It was not started by the dashboard, so sending resumes the session in a new process rather than typing into the running one.
            </p>
          </div>
        </div>
      </template>
      <template v-else>
        <!-- Session context: what you read while reading the transcript. -->
        <div
          v-if="hasContext"
          data-testid="agent-context"
          class="flex-shrink-0 max-h-[170px] overflow-y-auto border-b border-line px-4 py-2 flex flex-col gap-3"
        >
          <TaskList v-if="agent.tasks.length > 0" :tasks="agent.tasks" />
          <SubAgentList v-if="agent.subagents.length > 0" :subagents="agent.subagents" @open="openSubagent = $event" />
          <ToolTimeline v-if="agent.lastTools.length > 0" :tools="agent.lastTools" />
          <HookEventList v-if="(agent.recentHookEvents?.length ?? 0) > 0" :events="agent.recentHookEvents ?? []" />
        </div>
        <AgentChatStream
          ref="chatStreamRef"
          :agent="agent"
          :local-messages="localMessages"
          class="flex-1 min-h-0 overflow-y-auto p-4"
        />
      </template>
      <PromptInput v-if="!agent.machine" ref="promptInputRef" :agent="agent" variant="full" :approve-handler="approveHandler" @message-sent="onMessageSent" />
      <PluginSlot name="agent-modal-footer" :ctx="{ agent }" />
    </div>
  </AppModal>
</template>
