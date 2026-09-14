<script setup lang="ts">
import type { TopologyWorkspace } from '../runtimeTopology'
import type { MachineService } from '@/features/localscope'
import type { Agent } from '@/types'
import { computed } from 'vue'
import AgentGlyph from '@/components/ui/AgentGlyph.vue'
import LocalServicePort from '@/components/ui/LocalServicePort.vue'
import { workspaceDisplay } from '@/utils/agentGroup'
import { agentTitle } from '@/utils/agentLabels'
import { shortModel } from '@/utils/format'
import { localServiceUrl } from '@/utils/localServiceUrl'
import { agentDisplayStatus, statusLabel } from '@/utils/statusColors'

/*
 * One workspace and what runs in it, drawn as a branch of the runtime tree.
 *
 *   Workspace   the region, led by its branch mark, branch and checkout kind
 *     Agent     category glyph, a still state dot and word, name and model
 *     Processes a process mark, how many and their names
 *     Services  a service mark and the listening ports
 *
 * Each node type has its own mark and its own word, so Agent never looks like
 * Process and Service never looks like Agent. The connector lines are drawn by
 * pseudo-elements and are decoration only: the hierarchy reaches assistive
 * technology through the nested, labelled lists and the words.
 *
 * Workspace words come from workspaceDisplay, the helper the Agents roster
 * grouping uses, so "main checkout", "worktree", "Detached HEAD", "Branch
 * unknown" and "not a Git repository" mean one thing on both surfaces.
 *
 * No path is shown. The workspace is identified by its branch and kind; a
 * worktree also shows its directory name, the one safe distinguishing fact
 * when two of them are detached. The only motion is the rail's flow, and only
 * when `flowing` says the evidence is live.
 */
const props = defineProps<{
  node: TopologyWorkspace
  servicesKnown: boolean
  processesKnown: boolean
  /** A working agent here, live updates and a current LocalScope reading (see RuntimeTopologyTree). */
  flowing?: boolean
}>()

const display = computed(() => workspaceDisplay(props.node.workspace))
const isPlain = computed(() => props.node.workspace.kind === 'plain')
const showName = computed(() =>
  props.node.workspace.kind === 'git-worktree'
  && !!props.node.workspace.name
  && props.node.workspace.name !== display.value.title)

const MAX_PROCESS_NAMES = 4
const processNames = computed(() => {
  const names = [...new Set(props.node.processes.map(p => p.name))]
  const shown = names.slice(0, MAX_PROCESS_NAMES).join(', ')
  return names.length > MAX_PROCESS_NAMES ? `${shown}, …` : shown
})

function agentLabel(agent: Agent): string {
  return `${agentTitle(agent)} · ${statusLabel(agentDisplayStatus(agent))} · ${shortModel(agent.model ?? null)}`
}

/*
 * State-aware without being an activity signal: a still dot in the state's
 * colour beside the state word. No motion — the topology is structure.
 */
const STATE_DOT: Record<string, string> = {
  working: 'bg-state-working',
  waiting: 'bg-state-waiting',
  active: 'bg-state-success',
  error: 'bg-state-error',
}
function stateDot(agent: Agent): string {
  return STATE_DOT[agentDisplayStatus(agent)] ?? 'bg-state-idle'
}

/*
 * One pill per port (a service can listen on IPv4 and IPv6 at once). When one
 * of a port's observations has a local address, that one is drawn, so the pill
 * opens the service (3N.2.3) exactly as Runtime → Services does.
 */
const portServices = computed(() => {
  const byPort = new Map<number, MachineService>()
  for (const s of props.node.services) {
    const seen = byPort.get(s.port)
    if (!seen || (!localServiceUrl(seen) && localServiceUrl(s)))
      byPort.set(s.port, s)
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port)
})

const listLabel = computed(() => isPlain.value
  ? `Local workspace ${props.node.workspace.name}, not in a Git repository`
  : `${props.node.workspace.kind === 'git-worktree' ? 'Worktree' : 'Main checkout'} workspace ${display.value.title}`)

// One branch tick per child row, drawn from the list's rail.
const BRANCH = 'relative before:absolute before:-left-3 before:top-[0.7rem] before:h-px before:w-2.5 before:bg-line-strong'
</script>

<template>
  <div
    class="rounded-control border border-line bg-app px-2.5 py-2 flex flex-col gap-1.5 min-w-0"
    data-testid="topology-workspace"
    :data-workspace-id="node.workspace.id"
    :data-workspace-kind="node.workspace.kind"
  >
    <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 text-ui-sm">
      <span class="text-label uppercase tracking-wider text-fg-faint">{{ isPlain ? 'Local workspace' : 'Workspace' }}</span>
      <span v-if="!isPlain" class="text-fg-faint" aria-hidden="true">⑂</span>
      <span class="font-mono font-medium text-fg break-all">{{ display.title }}</span>
      <span class="text-fg-mute">{{ display.kind }}</span>
      <span v-if="showName" class="font-mono text-fg-faint break-all">{{ node.workspace.name }}</span>
    </p>

    <ul
      class="ml-1.5 flex flex-col gap-1 border-l border-line-strong pl-3 text-ui-sm min-w-0"
      :class="flowing ? 'cc-rail-flow motion-rail' : ''"
      :data-flowing="flowing ? 'true' : undefined"
      :aria-label="listLabel"
    >
      <li
        v-for="a in node.agents"
        :key="`${a.sessionId}-${a.pid}`"
        class="flex items-center gap-2 min-w-0"
        :class="BRANCH"
        data-testid="topology-agent"
      >
        <span class="text-label uppercase tracking-wider text-fg-faint w-20 shrink-0">Agent</span>
        <span class="flex items-center gap-1.5 min-w-0">
          <AgentGlyph :agent="a" size="sm" />
          <span class="size-1.5 shrink-0 rounded-full" :class="stateDot(a)" aria-hidden="true" />
          <span class="text-fg truncate">{{ agentLabel(a) }}</span>
        </span>
      </li>
      <li v-if="node.agents.length === 0" class="flex items-baseline gap-2" :class="BRANCH" data-testid="topology-no-agents">
        <span class="text-label uppercase tracking-wider text-fg-faint w-20 shrink-0">Agents</span>
        <span class="text-fg-faint">none observed</span>
      </li>

      <!-- Omitted entirely when the list was not reported; stated once above the tree. -->
      <li v-if="processesKnown" class="flex items-center gap-2 min-w-0" :class="BRANCH" data-testid="topology-processes">
        <span class="text-label uppercase tracking-wider text-fg-faint w-20 shrink-0">Processes</span>
        <svg viewBox="0 0 16 16" class="size-3.5 shrink-0 text-fg-faint" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true" focusable="false">
          <path d="M3.5 3.5h9v9h-9z" />
          <path d="M6.5 6.5h3v3h-3z" />
        </svg>
        <span v-if="node.processes.length > 0" class="text-fg-mute truncate">{{ node.processes.length }} — {{ processNames }}</span>
        <span v-else class="text-fg-faint">none observed</span>
      </li>

      <li v-if="servicesKnown" class="flex items-center gap-2 min-w-0" :class="BRANCH" data-testid="topology-services">
        <span class="text-label uppercase tracking-wider text-fg-faint w-20 shrink-0">Services</span>
        <svg viewBox="0 0 16 16" class="size-3.5 shrink-0 text-fg-faint" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true" focusable="false">
          <path d="M6 2.5v3M10 2.5v3" />
          <path d="M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0z" />
          <path d="M8 11.5v2" />
        </svg>
        <!-- Port pills, neutral: a listening port is structure, not success or liveness; a local one is a link. -->
        <ul v-if="portServices.length > 0" class="m-0 p-0 list-none flex flex-wrap gap-1 min-w-0" :aria-label="`Listening ports in ${listLabel}`">
          <li v-for="s in portServices" :key="s.port" class="contents">
            <LocalServicePort :service="s" size="sm" testid="topology-port" />{{ ' ' }}
          </li>
        </ul>
        <span v-else class="text-fg-faint">none observed</span>
      </li>
    </ul>
  </div>
</template>
