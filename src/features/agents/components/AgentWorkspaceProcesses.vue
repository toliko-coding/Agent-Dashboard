<script setup lang="ts">
import type { Agent } from '@/types'
import { computed } from 'vue'
import { DataFreshnessIndicator } from '@/features/localscope'
import { useAgentProcesses } from '../composables/useAgentProcesses'

/*
 * The processes running in this agent's workspace.
 *
 * The first consumer of process workspace identity. Membership is exactly
 * `process.workspace.id === agent.workspace.id` — see useAgentProcesses; there
 * is no containment, no name match and no fallback.
 *
 * What is NOT shown is as deliberate as what is. No cwd and no path: the
 * workspace is already established by being in this section, and repeating an
 * absolute path per row would add exposure for no information. No command line
 * either — it is the field most likely to carry a token or a local path, and
 * "which processes are running here" is answerable without it.
 */
const props = defineProps<{ agent: Agent }>()

const { attribution, processes, unresolvedCount, reading } = useAgentProcesses(() => props.agent)

const MAX_ROWS = 8
const shown = computed(() => processes.value.slice(0, MAX_ROWS))
const hidden = computed(() => Math.max(0, processes.value.length - MAX_ROWS))

/*
 * A list that was never observed must not render as an empty one — that is the
 * null-vs-zero rule this whole model is built on. A STALE list still renders:
 * it describes processes that were running moments ago, which is far closer to
 * the truth than showing none, and the indicator says how old it is.
 */
const observed = computed(() => reading.value.items !== null)

function formatMemory(bytes: number | null): string | null {
  if (bytes === null)
    return null
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/** Only the metrics ps actually reported; null stays absent, never 0. */
function metrics(p: { cpuPercent: number | null, memoryBytes: number | null }): string[] {
  const out: string[] = []
  if (p.cpuPercent !== null)
    out.push(`${p.cpuPercent.toFixed(0)}% cpu`)
  const mem = formatMemory(p.memoryBytes)
  if (mem !== null)
    out.push(mem)
  return out
}
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="agent-workspace-processes">
    <header class="flex items-baseline gap-2">
      <h3 class="text-[10px] uppercase tracking-wider text-fg-faint font-bold">
        Processes in this workspace
      </h3>
      <span
        v-if="attribution === 'resolved' && observed && processes.length > 0"
        class="text-[10px] font-mono text-fg-faint"
      >{{ processes.length }}</span>
      <DataFreshnessIndicator :reading="reading" testid="workspace-processes-freshness" />
    </header>

    <!--
      Attribution was never attempted: this agent has no workspace identity to
      compare against. Neutral, because an unidentifiable workspace is an
      ordinary condition rather than a fault.
    -->
    <p
      v-if="attribution === 'agent-unresolved'"
      class="text-[11px] text-fg-mute"
      data-testid="workspace-processes-identity-unknown"
    >
      Workspace identity unavailable, so processes cannot be attributed to this agent.
    </p>

    <!-- Nothing was collected. Not the same as "nothing is running". -->
    <p
      v-else-if="!observed"
      class="text-[11px] text-fg-mute"
      data-testid="workspace-processes-unavailable"
    >
      LocalScope has not reported a process list.
    </p>

    <p
      v-else-if="processes.length === 0"
      class="text-[11px] text-fg-mute"
      data-testid="workspace-processes-none"
    >
      No developer processes observed in this workspace.
    </p>

    <ul v-else class="flex flex-col gap-1" data-testid="workspace-processes-list">
      <li
        v-for="p in shown"
        :key="p.id"
        class="flex items-baseline gap-2 min-w-0 rounded border border-line bg-card px-2 py-1"
        :data-testid="`workspace-process-${p.pid}`"
      >
        <span class="text-[11px] text-fg truncate">{{ p.name }}</span>
        <span class="text-[10px] font-mono text-fg-faint shrink-0">{{ p.pid }}</span>
        <span v-if="p.runtime && p.runtime !== 'unknown'" class="text-[10px] text-fg-mute shrink-0">{{ p.runtime }}</span>
        <span
          v-for="m in metrics(p)"
          :key="m"
          class="text-[10px] font-mono text-fg-faint shrink-0"
        >{{ m }}</span>
        <span
          v-if="p.ports.length > 0"
          class="ml-auto text-[10px] font-mono text-success-text shrink-0"
          :title="`Listening on ${p.ports.join(', ')}`"
        >:{{ p.ports.join(' :') }}</span>
      </li>
    </ul>

    <p v-if="hidden > 0" class="text-[10px] text-fg-faint" data-testid="workspace-processes-overflow">
      +{{ hidden }} more not shown
    </p>

    <!--
      Observations nothing could attribute — typically a process whose cwd is
      not readable. Stated so "none here" is never mistaken for certainty.
    -->
    <p
      v-if="attribution === 'resolved' && observed && unresolvedCount > 0"
      class="text-[10px] text-fg-faint"
      data-testid="workspace-processes-unattributed"
    >
      {{ unresolvedCount }} observed {{ unresolvedCount === 1 ? 'process' : 'processes' }}
      could not be attributed to any workspace.
    </p>
  </section>
</template>
