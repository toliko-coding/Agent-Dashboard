<script setup lang="ts">
import type { Agent } from '@/types'
import type { AgentGrouping } from '@/utils/agentGroup'
import { computed } from 'vue'
import GroupHeader from '@/components/shell/GroupHeader.vue'
import { groupDetail, groupPrefix } from '@/utils/agentGroup'
import AgentRow from './AgentRow.vue'
import WorkspaceGroupRow from './WorkspaceGroupRow.vue'

const props = defineProps<{
  agents: Agent[]
  groups?: AgentGrouping[]
}>()

const emit = defineEmits<{
  select: [agent: Agent]
}>()

// Groups with non-null labels trigger the grouped rendering path.
const useGroups = computed(() =>
  !!props.groups && props.groups.some(g => g.label !== null),
)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <!-- Grouped rendering -->
    <template v-if="useGroups && groups">
      <div v-for="group in groups" :key="group.key" class="flex flex-col gap-1.5">
        <GroupHeader
          :label="group.label!"
          :agents="group.agents"
          :derived-from="group.derivedFrom"
          :prefix="groupPrefix(group)"
          :detail="groupDetail(group)"
          class="mt-2 first:mt-0"
        />
        <!-- Second level, repository-and-workspace mode only. -->
        <template v-if="group.children">
          <template v-for="child in group.children" :key="child.key">
            <WorkspaceGroupRow :workspace="child.workspace!" :agents="child.agents" />
            <AgentRow
              v-for="agent in child.agents"
              :key="agent.pid"
              :agent="agent"
              @select="emit('select', agent)"
            />
          </template>
        </template>
        <template v-else>
          <AgentRow
            v-for="agent in group.agents"
            :key="agent.pid"
            :agent="agent"
            @select="emit('select', agent)"
          />
        </template>
      </div>
    </template>

    <!-- Flat rendering -->
    <template v-else>
      <AgentRow
        v-for="agent in agents"
        :key="agent.pid"
        :agent="agent"
        @select="emit('select', agent)"
      />
      <p v-if="agents.length === 0" class="text-center py-12 text-fg-mute text-sm">
        No running Claude agents found.
      </p>
    </template>
  </div>
</template>
