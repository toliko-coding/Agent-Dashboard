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
import { formatCost, formatTokens, shortModel, totalTokenCount } from '@/utils/format'
import { agentDisplayStatus } from '@/utils/statusColors'
import AgentChatStream from './AgentChatStream.vue'
import AgentIntelligencePanel from './AgentIntelligencePanel.vue'
import MetricsPopover from './MetricsPopover.vue'
import SubAgentList from './SubAgentList.vue'

const props = defineProps<{ agent: Agent | null }>()

const emit = defineEmits<{ close: [], navigate: [taskId: string] }>()

const localMessages = ref<OutputMessage[]>([])
const promptInputRef = ref<InstanceType<typeof PromptInput> | null>(null)
const chatStreamRef = ref<InstanceType<typeof AgentChatStream> | null>(null)
const showMetrics = ref(false)

/*
 * The workspace supersedes the Overview/Transcript tabs of the previous drawer.
 * Intelligence now sits permanently beside the conversation instead of behind
 * a tab, so there is nothing to switch between.
 *
 * Still deliberately absent, for the same reasons as before: a "Files" section
 * would need a per-agent file list (meta carries only counts, and no endpoint
 * returns paths), and "Settings" would need per-agent configuration that does
 * not exist — spawners are global.
 */

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

/** Wall-clock start time, derived from uptime — a real value, not an estimate. */
const startedAt = computed(() => {
  const a = props.agent
  if (!a || !Number.isFinite(a.uptime))
    return null
  return new Date(Date.now() - a.uptime * 1000)
    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
    :labelled-by="agent ? `agent-modal-title-${agent.pid}` : undefined"
    @close="emit('close')"
  >
    <!--
      A workspace, not a drawer. The 560px side panel forced the conversation —
      the thing you actually came to read and reply to — into a column narrower
      than a phone. This is a large surface where the conversation is primary
      and the intelligence column sits beside it rather than behind a tab.
    -->
    <div
      v-if="agent"
      data-testid="agent-workspace"
      class="w-[min(1500px,96vw)] h-[min(920px,92vh)] bg-card border border-line rounded-xl shadow-modal flex flex-col overflow-hidden"
    >
      <!-- Header spans the full width -->
      <header class="bg-raised px-4 py-2.5 flex flex-col gap-2 flex-shrink-0 border-b border-line">
        <div class="flex items-center gap-2.5 min-w-0">
          <AppBadge :variant="agentDisplayStatus(agent)" />
          <span aria-hidden="true">{{ getIdentity(agent.projectPath).emoji }}</span>
          <span :id="`agent-modal-title-${agent.pid}`" class="font-semibold text-sm text-fg truncate">{{ agent.projectName }}</span>
          <MachineBadge v-if="agent.machine" :machine="agent.machine" />

          <span
            class="relative shrink-0 ml-1"
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

          <button
            type="button"
            aria-label="Close"
            class="ml-auto shrink-0 bg-transparent border-none text-fg-mute text-base cursor-pointer px-2 py-1 rounded hover:bg-card hover:text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <!--
          Facts, each rendered only when it is backed by real data. There is no
          Pause and no Stop: no such endpoint exists for an agent process.
        -->
        <dl class="flex items-center gap-x-5 gap-y-1 flex-wrap text-[11px] min-w-0">
          <div class="flex items-baseline gap-1.5 min-w-0">
            <dt class="text-fg-faint">
              Model
            </dt>
            <dd class="font-mono text-fg-soft truncate">
              {{ shortModel(agent.model ?? null) }}
            </dd>
          </div>
          <div v-if="taskProgress" class="flex items-baseline gap-1.5" data-testid="header-tasks">
            <dt class="text-fg-faint">
              Tasks
            </dt>
            <dd class="font-mono text-fg-soft tabular-nums">
              {{ taskProgress.done }} / {{ taskProgress.total }}
            </dd>
          </div>
          <div v-if="startedAt" class="flex items-baseline gap-1.5">
            <dt class="text-fg-faint">
              Started
            </dt>
            <dd class="font-mono text-fg-soft tabular-nums">
              {{ startedAt }}
            </dd>
          </div>
          <div v-if="agent.spawnerName" class="flex items-baseline gap-1.5 min-w-0">
            <dt class="text-fg-faint">
              Spawner
            </dt>
            <dd class="font-mono text-fg-soft truncate">
              {{ agent.spawnerName }}
            </dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt class="text-fg-faint">
              Cost
            </dt>
            <dd class="font-mono text-fg-soft tabular-nums">
              {{ formatCost(agent.costEstimate) }} · {{ formatTokens(totalTokens) }} tok
            </dd>
          </div>
        </dl>
      </header>

      <CrossLinkBanner
        v-if="agent.pipelineTaskId"
        label="Part of"
        :target-name="agent.pipelineTaskTitle ?? `Task ${agent.pipelineTaskId.slice(0, 8)}`"
        button-text="Open →"
        @click="emit('navigate', agent.pipelineTaskId)"
      />

      <!--
        Intelligence ~32% / conversation ~68% on desktop. Below lg the
        intelligence column is dropped rather than stacked: on a narrow screen
        the conversation is the whole point, and a stacked sidebar would push
        it off-screen.
      -->
      <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,32%)_minmax(0,68%)]">
        <AgentIntelligencePanel
          v-if="!openSubagent"
          :agent="agent"
          class="hidden lg:flex"
        />

        <section class="flex flex-col min-h-0 min-w-0 lg:col-start-2" aria-label="Conversation">
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

          <template v-else>
            <!-- Session context: what you read while reading the transcript. -->
            <div
              v-if="hasContext"
              data-testid="agent-context"
              class="flex-shrink-0 max-h-[150px] overflow-y-auto border-b border-line px-4 py-2 flex flex-col gap-3"
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

          <!--
            Sending is only offered where it can actually land. A remote session
            has no route from here; one the dashboard did not spawn is resumed
            in a new process rather than typed into, which PromptInput confirms.
          -->
          <PromptInput
            v-if="canMessage"
            ref="promptInputRef"
            :agent="agent"
            variant="full"
            :approve-handler="approveHandler"
            @message-sent="onMessageSent"
          />
          <p
            v-else
            data-testid="agent-unreachable-note"
            class="flex-shrink-0 px-4 py-2 border-t border-line text-[11px] text-warning-text"
          >
            This session runs on {{ agent.machine }} and cannot be messaged from here.
          </p>
          <p
            v-if="canMessage && !agent.liveInjectable"
            data-testid="agent-resume-note"
            class="flex-shrink-0 px-4 pb-2 text-[10px] text-fg-faint"
          >
            Not started by the dashboard — sending resumes the session in a new process rather than typing into the running one.
          </p>
          <PluginSlot name="agent-modal-footer" :ctx="{ agent }" />
        </section>
      </div>
    </div>
  </AppModal>
</template>
