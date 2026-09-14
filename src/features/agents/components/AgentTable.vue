<script setup lang="ts">
import type { AttentionItem } from '@/features/attention'
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
  /** The canonical attention queue's items; each row shows only its own. */
  attentionItems?: AttentionItem[]
  /** Last-known agents while updates reconnect: every row holds still. */
  stale?: boolean
}>()

const emit = defineEmits<{
  select: [agent: Agent]
}>()

// The same lookup as the card grid, so a row and a card show the same item.
const attentionBySession = computed(() => {
  const map = new Map<string, AttentionItem>()
  for (const item of props.attentionItems ?? []) {
    if (item.subject.type === 'agent')
      map.set(item.subject.sessionId, item)
  }
  return map
})

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
              :attention="attentionBySession.get(agent.sessionId) ?? null"
              :stale="stale"
              @select="emit('select', agent)"
            />
          </template>
        </template>
        <template v-else>
          <AgentRow
            v-for="agent in group.agents"
            :key="agent.pid"
            :agent="agent"
            :attention="attentionBySession.get(agent.sessionId) ?? null"
            :stale="stale"
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
        :attention="attentionBySession.get(agent.sessionId) ?? null"
        :stale="stale"
        @select="emit('select', agent)"
      />
      <p v-if="agents.length === 0" class="text-center py-12 text-fg-mute text-sm">
        No running Claude agents found.
      </p>
    </template>
  </div>
</template>
