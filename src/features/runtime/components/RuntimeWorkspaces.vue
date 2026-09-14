<script setup lang="ts">
import { useAgents } from '@/features/agents'
import { RuntimeTopologyTree } from '@/features/cockpit'

/*
 * The runtime topology as a section of its own: repository → workspace →
 * agents, processes and services, placed by opaque identity only.
 *
 * The same tree Command shows beneath its Runtime summary — one model
 * (buildRuntimeTopology), one set of identity rules. Here it is always open,
 * because opening this section is the explicit request for it; that mount is
 * what starts the service and process lists.
 */
const { agents } = useAgents({ autoStart: false })
</script>

<template>
  <section aria-labelledby="runtime-workspaces-heading" class="flex min-w-0 flex-col gap-3" data-testid="runtime-workspaces">
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id="runtime-workspaces-heading" class="m-0 text-title font-semibold text-fg">
        Workspaces
      </h2>
      <span class="text-ui-sm text-fg-mute">What runs in each repository and workspace, grouped by identity</span>
    </header>
    <RuntimeTopologyTree :agents="agents" />
  </section>
</template>
