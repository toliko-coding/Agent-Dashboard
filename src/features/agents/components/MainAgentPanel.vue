<script setup lang="ts">
import type { Agent } from '@/types'
import { computed, ref } from 'vue'
import AgentGlyph from '@/components/ui/AgentGlyph.vue'
import AppBadge from '@/components/ui/AppBadge.vue'
import { agentIsDashboardOwned } from '@/composables/useAgentLifecycle'
import { linkMainAgentSession, useMainAgentRecord } from '@/features/agents/composables/useMainAgentRecord'
import { agentTitle } from '@/utils/agentLabels'
import { permissionModeShortLabel } from '@/utils/permissionModes'
import { agentDisplayStatus, statusLabel } from '@/utils/statusColors'

/*
 * The agent that maintains Agent Dashboard, shown as itself.
 *
 * It is a durable record, so it exists whether or not a Claude session is
 * running it — which is exactly why it gets a panel rather than a card in the
 * roster. A card would have to disappear the moment the process exited, and the
 * agent responsible for this dashboard would vanish from the page that lists
 * agents.
 *
 * Underneath there is nothing special: the session it runs is an ordinary
 * session, found in the same roster as every other, with the same ownership
 * rules deciding what may be done to it. No separate runtime, no invented
 * activity, no animation that is not reporting something real.
 *
 * Linking only records which session is running the main agent. It grants
 * nothing: an external session — which is what a Manager started from an editor
 * is — keeps every limit it had and gains a label. Candidates are restricted to
 * sessions in the agent's own folder, so this cannot become a way to designate
 * any agent as main.
 */
const props = defineProps<{
  /** The roster, so the linked session can be resolved without a second source. */
  agents: Agent[]
}>()
const emit = defineEmits<{ select: [agent: Agent] }>()

const { mainAgent, mainSessionId, refresh } = useMainAgentRecord()
const linking = ref(false)
const error = ref('')

/** The session running the main agent right now, when one is. */
const session = computed(() => {
  const id = mainSessionId.value
  return id ? props.agents.find(a => a.sessionId === id && a.status !== 'finished') ?? null : null
})

/** Sessions that could be the main agent: running, in its own folder. */
const candidates = computed(() => {
  const cwd = mainAgent.value?.cwd
  if (!cwd || session.value)
    return []
  return props.agents.filter(a => a.cwd === cwd && a.status !== 'finished' && !a.internalProcess && !a.machine)
})

/*
 * A session this dashboard did not start - normally the Claude running in the
 * user's own editor. It is observed here and owned there, so the panel says so
 * and offers to open it, and nothing on this page sends to it or ends it.
 */
const externalSession = computed(() => !!session.value && !agentIsDashboardOwned(session.value))

const confirmStart = ref(false)
const starting = ref(false)
/*
 * A session starts with a message, so starting one asks for it rather than
 * inventing an opening prompt on the user's behalf.
 */
const firstMessage = ref('')
const canStart = computed(() => firstMessage.value.trim().length > 0 && !starting.value)

const title = computed(() => mainAgent.value?.displayName || 'Agent Dashboard Manager')
const sessionState = computed(() => session.value ? statusLabel(agentDisplayStatus(session.value)) : null)

/*
 * Starting the main agent is explicit, and confirmed against what it will
 * actually start with: the folder, the saved permission mode, and whether it
 * has saved instructions. Nothing is invented - a record with no saved mode
 * starts on Claude's default, which is what the confirmation says.
 *
 * It goes through the ordinary spawn route, which refuses to resume the main
 * agent while a session is already running it. So this button cannot produce a
 * second main agent even if the roster is wrong about the first.
 */
async function startMain() {
  const cfg = mainAgent.value
  if (!cfg || starting.value)
    return
  if (!cfg.cwd) {
    error.value = 'This agent has no folder recorded, so nothing can be started from here.'
    return
  }
  if (!canStart.value)
    return
  starting.value = true
  error.value = ''
  try {
    const body: Record<string, unknown> = { prompt: firstMessage.value.trim(), cwd: cfg.cwd, enableChannel: true }
    if (cfg.sessionId)
      body.resumeSessionId = cfg.sessionId
    if (cfg.permissionMode)
      body.permissionMode = cfg.permissionMode
    if (cfg.instructions)
      body.systemPrompt = cfg.instructions
    const res = await fetch('/api/agents/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const failed = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(failed?.error || `Could not start the main agent (${res.status})`)
    }
    confirmStart.value = false
    firstMessage.value = ''
    await refresh()
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    starting.value = false
  }
}

async function link(pid: number) {
  linking.value = true
  error.value = ''
  try {
    await linkMainAgentSession(pid)
    await refresh()
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
  finally {
    linking.value = false
  }
}
</script>

<template>
  <section
    v-if="mainAgent"
    class="mb-4 flex min-w-0 flex-col gap-2 rounded-panel border border-accent/40 bg-card px-4 py-3"
    aria-labelledby="main-agent-heading"
    data-testid="main-agent-panel"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <AgentGlyph :agent="{ category: mainAgent.category }" size="lg" />
      <span class="flex min-w-0 flex-col">
        <span class="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id="main-agent-heading" class="m-0 truncate text-title font-semibold text-fg" data-testid="main-agent-name">
            {{ title }}
          </h2>
          <span
            class="shrink-0 rounded-control border border-accent/50 px-1.5 py-px text-label font-semibold uppercase tracking-wide text-accent"
            data-testid="main-agent-badge"
          >Main agent</span>
        </span>
        <span class="text-ui-sm text-fg-mute" data-testid="main-agent-description">
          Maintains Agent Dashboard itself. A role, not a permission — it grants no access other agents do not have.
        </span>
      </span>

      <span class="ml-auto flex shrink-0 items-center gap-2">
        <template v-if="session">
          <AppBadge :variant="agentDisplayStatus(session)" />
          <button
            type="button"
            class="cursor-pointer rounded-lg border border-line bg-raised/50 px-3 py-1 text-ui-sm text-accent hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            data-testid="main-agent-open"
            @click="emit('select', session)"
          >
            {{ externalSession ? 'Observe session' : 'Open session' }}
          </button>
        </template>
        <span v-else class="text-ui-sm text-fg-mute" data-testid="main-agent-no-session">No session running</span>
      </span>
    </div>

    <p v-if="session" class="m-0 text-ui-sm text-fg-mute" data-testid="main-agent-session">
      Running as {{ agentTitle(session) }} · {{ sessionState }}
    </p>
    <p v-if="externalSession" class="m-0 text-ui-sm text-fg-mute" data-testid="main-agent-external">
      This session runs outside Agent Dashboard, which observes it and does not control it. Open it to read along; it is continued where it was started, and starting another here would run a second main agent.
    </p>

    <!--
      Offered only here, and only for a session in this agent's own folder: the
      main agent is seeded, so nothing anywhere promotes an ordinary agent.
    -->
    <div v-else-if="candidates.length" class="flex min-w-0 flex-col gap-1.5" data-testid="main-agent-link">
      <span class="text-ui-sm text-fg-mute">Which session is maintaining Agent Dashboard right now?</span>
      <span class="flex flex-wrap gap-2">
        <button
          v-for="candidate in candidates"
          :key="candidate.pid"
          type="button"
          :disabled="linking"
          class="cursor-pointer rounded-lg border border-line bg-raised/50 px-3 py-1 text-ui-sm text-fg-soft hover:bg-raised disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
          :data-testid="`main-agent-link-${candidate.pid}`"
          @click="link(candidate.pid)"
        >
          {{ agentTitle(candidate) }}
        </button>
      </span>
    </div>

    <!--
      No session: starting one is offered here and nowhere else, so it is always
      a deliberate act with its configuration in front of the user first.
    -->
    <div v-if="!session" class="flex min-w-0 flex-col gap-1.5" data-testid="main-agent-start">
      <button
        v-if="!confirmStart"
        type="button"
        class="self-start cursor-pointer rounded-lg border border-accent/50 bg-accent-soft/40 px-3 py-1 text-ui-sm font-medium text-accent hover:bg-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
        data-testid="main-agent-start-button"
        @click="confirmStart = true"
      >
        Start main agent
      </button>
      <div v-else role="group" aria-label="Confirm starting the main agent" class="flex min-w-0 flex-col gap-1.5" data-testid="main-agent-start-confirm">
        <p class="m-0 text-ui-sm text-fg-soft">
          Starts a session for {{ title }} in
          <span class="font-mono" data-testid="main-agent-start-folder">{{ mainAgent?.cwd }}</span>, which
          <span data-testid="main-agent-start-mode">{{ permissionModeShortLabel(mainAgent?.permissionMode || 'default').toLowerCase() }}</span>.
          <span data-testid="main-agent-start-instructions">{{ mainAgent?.instructions ? 'Its saved instructions are applied.' : 'It has no saved instructions.' }}</span>
        </p>
        <label class="flex flex-col gap-1 text-ui-sm text-fg-mute" for="main-agent-start-message">
          First message
          <textarea
            id="main-agent-start-message"
            v-model="firstMessage"
            rows="2"
            placeholder="What should it do?"
            class="w-full rounded-control border border-line bg-app px-2 py-1 text-ui text-fg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            data-testid="main-agent-start-message"
          />
        </label>
        <span class="flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="!canStart"
            class="cursor-pointer rounded-lg border border-accent/50 bg-accent-soft/40 px-3 py-1 text-ui-sm font-medium text-accent hover:bg-raised disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            data-testid="main-agent-start-confirm-button"
            @click="startMain()"
          >
            {{ starting ? 'Starting…' : 'Start session' }}
          </button>
          <button
            type="button"
            :disabled="starting"
            class="cursor-pointer rounded-lg border border-line bg-transparent px-3 py-1 text-ui-sm text-fg-mute hover:bg-raised disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
            data-testid="main-agent-start-cancel"
            @click="confirmStart = false"
          >
            Cancel
          </button>
        </span>
      </div>
    </div>

    <p v-if="error" class="m-0 text-ui-sm text-danger-text" role="alert" data-testid="main-agent-error">
      {{ error }}
    </p>
  </section>
</template>
