<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { DataFreshnessIndicator, useMachineProcesses, useMachineServices } from '@/features/localscope'
import { friendlyProjectName } from '@/utils/friendlyProjectName'
import { agentDisplayStatus, statusLabel } from '@/utils/statusColors'
import { buildRuntimeTopology } from '../runtimeTopology'
import TopologyWorkspaceNode from './TopologyWorkspaceNode.vue'

/*
 * Draws the runtime topology model. All placement decisions live in
 * buildRuntimeTopology; this component only renders what it was given.
 *
 * Structural, not an activity signal: no motion, no state colour on the
 * hierarchy itself. Node types are stated in words — Repository, Workspace,
 * Agent, Processes, Services — so the structure survives without colour and
 * without seeing the indentation.
 */
const props = defineProps<{ agents: Agent[] }>()

const services = useMachineServices()
const processes = useMachineProcesses()

// Not a list means not observed — including a malformed body — never an empty list.
const serviceItems = computed(() => {
  const value = services.data.value.items
  return Array.isArray(value) ? value : null
})
const processItems = computed(() => {
  const value = processes.data.value.items
  return Array.isArray(value) ? value : null
})

const topology = computed(() => buildRuntimeTopology({
  agents: props.agents,
  services: serviceItems.value,
  processes: processItems.value,
}))

const unresolved = computed(() => topology.value.unresolved)
const hasUnresolved = computed(() =>
  unresolved.value.agents.length > 0
  || (unresolved.value.processes ?? 0) > 0
  || (unresolved.value.services ?? 0) > 0)

const isEmpty = computed(() =>
  topology.value.repositories.length === 0 && topology.value.local.length === 0 && !hasUnresolved.value)

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
</script>

<template>
  <div class="flex flex-col gap-2 min-w-0" data-testid="runtime-topology-tree">
    <!-- Source honesty first: an unreported list is unknown, not empty. -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-mute">
      <p v-if="serviceItems === null" data-testid="topology-services-unavailable">
        Services not reported by LocalScope — service attribution unknown.
      </p>
      <p v-if="processItems === null" data-testid="topology-processes-unavailable">
        Processes not reported by LocalScope — process attribution unknown.
      </p>
      <DataFreshnessIndicator :reading="services.data.value" testid="topology-services-freshness" />
      <DataFreshnessIndicator :reading="processes.data.value" testid="topology-processes-freshness" />
    </div>

    <p v-if="isEmpty" class="text-[11px] text-fg-mute" data-testid="topology-empty">
      Nothing observed yet.
    </p>

    <!-- Wraps to one column on narrow widths rather than scrolling sideways. -->
    <ul v-else class="grid grid-cols-1 lg:grid-cols-2 gap-2 min-w-0" aria-label="Repositories and workspaces">
      <li
        v-for="repo in topology.repositories"
        :key="repo.key"
        class="rounded-lg border border-line p-2 min-w-0"
        data-testid="topology-repository"
        :data-repository-id="repo.id"
      >
        <p class="flex items-baseline gap-2 min-w-0">
          <span class="text-[10px] uppercase tracking-wider text-fg-faint shrink-0">Repository</span>
          <span class="font-mono text-[12px] font-semibold text-fg truncate">{{ repo.label }}</span>
          <!-- Stated from two upward; "1 workspace" on every repository is noise. -->
          <span
            v-if="repo.workspaces.length >= 2"
            class="text-[11px] text-fg-faint shrink-0"
            data-testid="topology-workspace-count"
          >{{ repo.workspaces.length }} workspaces</span>
        </p>
        <ul class="flex flex-col gap-2 mt-1.5 min-w-0" :aria-label="`Workspaces in repository ${repo.label}`">
          <li v-for="node in repo.workspaces" :key="node.key">
            <TopologyWorkspaceNode
              :node="node"
              :services-known="serviceItems !== null"
              :processes-known="processItems !== null"
            />
          </li>
        </ul>
      </li>

      <li
        v-if="topology.local.length > 0"
        class="rounded-lg border border-line p-2 min-w-0"
        data-testid="topology-local"
      >
        <p class="flex flex-wrap items-baseline gap-2 min-w-0">
          <span class="text-[10px] uppercase tracking-wider text-fg-faint">Local workspaces</span>
          <span class="text-[11px] text-fg-faint">not in a Git repository</span>
        </p>
        <ul class="flex flex-col gap-2 mt-1.5 min-w-0" aria-label="Local workspaces, not in a Git repository">
          <li v-for="node in topology.local" :key="node.key">
            <TopologyWorkspaceNode
              :node="node"
              :services-known="serviceItems !== null"
              :processes-known="processItems !== null"
            />
          </li>
        </ul>
      </li>

      <!--
        Neutral, not an error: an observation with no workspace identity is an
        ordinary condition. Listed or counted here, never attached elsewhere.
      -->
      <li
        v-if="hasUnresolved"
        class="rounded-lg border border-dashed border-line p-2 min-w-0"
        data-testid="topology-unresolved"
      >
        <p class="text-[10px] uppercase tracking-wider text-fg-faint">
          Workspace unknown
        </p>
        <ul class="flex flex-col gap-0.5 mt-1 text-[11px] min-w-0" aria-label="Observations with no workspace identity">
          <li
            v-for="a in unresolved.agents"
            :key="`${a.sessionId}-${a.pid}`"
            class="flex items-baseline gap-2 min-w-0"
            data-testid="topology-unresolved-agent"
          >
            <span class="text-[10px] uppercase tracking-wider text-fg-faint w-16 shrink-0">Agent</span>
            <span class="text-fg truncate">{{ friendlyProjectName(a.projectName) }} · {{ statusLabel(agentDisplayStatus(a)) }}</span>
          </li>
          <li v-if="unresolved.processes" class="text-fg-mute" data-testid="topology-unresolved-processes">
            {{ plural(unresolved.processes, 'process', 'processes') }} could not be attributed to any workspace
          </li>
          <li v-if="unresolved.services" class="text-fg-mute" data-testid="topology-unresolved-services">
            {{ plural(unresolved.services, 'service', 'services') }} could not be attributed to any workspace
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
