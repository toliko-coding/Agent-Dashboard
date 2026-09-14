<script setup lang="ts">
defineProps<{
  searchQuery: string
}>()
</script>

<template>
  <!--
    A statement, not a hero (3L): what is absent and the next useful step, with
    no decorative illustration. "+ New Agent" is the topbar's own action.
  -->
  <div
    class="flex flex-col gap-1 rounded-panel border border-dashed border-line px-4 py-6"
    role="status"
    aria-label="No agents found"
    data-testid="empty-agent-state"
  >
    <p class="m-0 text-ui font-medium text-fg-soft">
      {{ searchQuery ? 'No agents match your search.' : 'No agents are currently running.' }}
    </p>
    <p v-if="!searchQuery" class="m-0 text-ui-sm text-fg-mute">
      Start a Claude Code session or use <strong class="font-semibold text-fg-soft">+ New Agent</strong> to spawn one.
    </p>
  </div>
</template>
