<script setup lang="ts">
defineProps<{ live: boolean }>()
</script>

<template>
  <!--
    The dot is static. "Connected" is a steady state, so a permanent pulse would
    be decoration, not information; it is drawn in the live colour because it
    reports live observation. The word carries the state, so it never depends on
    colour or motion alone.
  -->
  <div role="status" class="flex items-center gap-1.5 text-[11px]" :aria-label="live ? 'Live updates connected' : 'Reconnecting to live updates'">
    <span
      data-dot
      class="w-2 h-2 rounded-full"
      :class="live ? 'bg-live-dot' : 'bg-warning'"
      aria-hidden="true"
    />
    <span :class="live ? 'text-fg-mute' : 'text-warning-text'">
      {{ live ? 'Live' : 'Reconnecting…' }}
    </span>
  </div>
</template>
