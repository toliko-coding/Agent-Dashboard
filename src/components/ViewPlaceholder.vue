<script setup lang="ts">
/*
 * Honest placeholder for a destination whose data source does not exist yet.
 *
 * It deliberately states WHY the view is empty and what would populate it,
 * rather than rendering zeros or sample rows — a "0" here would read as
 * "checked, found none", which is a different and false claim.
 */
defineProps<{
  title: string
  summary: string
  /** What has to exist before this view can show real data. */
  requires?: string
  icon?: string
}>()
</script>

<template>
  <section class="grid place-items-center py-8" data-testid="view-placeholder">
    <div class="max-w-md text-center flex flex-col items-center gap-3 px-6">
      <span
        v-if="icon"
        class="w-9 h-9 rounded-panel bg-raised border border-line grid place-items-center text-body text-fg-faint"
        aria-hidden="true"
      >{{ icon }}</span>

      <h2 class="text-body font-semibold text-fg">
        {{ title }}
      </h2>

      <p class="text-ui text-fg-mute leading-relaxed">
        {{ summary }}
      </p>

      <p
        v-if="requires"
        class="text-ui-sm font-mono text-fg-mute rounded-control px-3 py-2 bg-recessed"
      >
        {{ requires }}
      </p>
    </div>
  </section>
</template>
