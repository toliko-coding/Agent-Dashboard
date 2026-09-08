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
  <section class="flex-1 grid place-items-center py-16" data-testid="view-placeholder">
    <div class="max-w-md text-center flex flex-col items-center gap-3 px-6">
      <span
        v-if="icon"
        class="w-12 h-12 rounded-xl bg-raised border border-line grid place-items-center text-[20px] text-fg-faint"
        aria-hidden="true"
      >{{ icon }}</span>

      <h2 class="text-[15px] font-semibold text-fg">
        {{ title }}
      </h2>

      <p class="text-[13px] text-fg-mute leading-relaxed">
        {{ summary }}
      </p>

      <p
        v-if="requires"
        class="text-[11px] font-mono text-fg-faint border border-line rounded-md px-3 py-2 bg-app"
      >
        {{ requires }}
      </p>
    </div>
  </section>
</template>
