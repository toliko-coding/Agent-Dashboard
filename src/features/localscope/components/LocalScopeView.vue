<script setup lang="ts">
import ViewPlaceholder from '../../../components/ViewPlaceholder.vue'

/*
 * LocalScope has no backend. The process scanner intentionally discards every
 * non-agent process (scanner.go), and there is no collector for listening
 * ports, emulators or network connections. This view therefore shows the
 * intended structure and states the gap — it renders no counts, because a "0"
 * would claim the system looked and found nothing.
 *
 * Phase 5 builds the real sections once a localhost collector exists.
 */
const SECTIONS = [
  { label: 'Local Services', hint: 'Dev servers and listening ports' },
  { label: 'Processes', hint: 'Runtimes and their working directories' },
  { label: 'Emulators', hint: 'iOS / Android simulators' },
  { label: 'Network', hint: 'Active local connections' },
  { label: 'Projects', hint: 'Detected project directories' },
]
</script>

<template>
  <section class="flex flex-col gap-4">
    <ViewPlaceholder
      icon="◉"
      title="LocalScope is not connected"
      summary="LocalScope will show the services, processes, emulators and network activity on this machine. No collector is running yet, so there is nothing to report."
      requires="Requires a localhost-only system collector — not yet implemented"
    />

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 opacity-60">
      <div
        v-for="s in SECTIONS"
        :key="s.label"
        class="border border-line rounded-lg bg-card p-3 flex flex-col gap-1"
      >
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-semibold text-fg-mute">{{ s.label }}</span>
          <span class="ml-auto text-[10px] font-mono text-fg-faint">n/a</span>
        </div>
        <span class="text-[11px] text-fg-faint">{{ s.hint }}</span>
      </div>
    </div>
  </section>
</template>
