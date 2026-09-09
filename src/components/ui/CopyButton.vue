<script setup lang="ts">
import { ref } from 'vue'

/*
 * Copy-to-clipboard for values a developer routinely needs elsewhere — a
 * filesystem path, a URL, a session id. Deliberately not offered on values you
 * would never paste anywhere (a percentage, a status word).
 *
 * The clipboard API is unavailable in insecure contexts and can be blocked, so
 * failure is silent and the text stays selectable: an error toast for a copy
 * the user can perform manually is noise.
 */
const props = withDefaults(defineProps<{
  value: string
  /** Names the thing being copied, for the accessible label. */
  label?: string
}>(), { label: 'value' })

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    if (timer)
      clearTimeout(timer)
    timer = setTimeout(() => {
      copied.value = false
    }, 1500)
  }
  catch {
    // Clipboard blocked — the text remains selectable.
  }
}
</script>

<template>
  <button
    type="button"
    data-testid="copy-button"
    class="inline-flex items-center justify-center min-w-6 min-h-6 shrink-0 rounded text-[10px] text-fg-faint hover:text-fg-soft hover:bg-raised transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent"
    :aria-label="copied ? `Copied ${label}` : `Copy ${label}`"
    @click.stop="copy"
  >
    <span aria-hidden="true">{{ copied ? '✓' : '⧉' }}</span>
  </button>
</template>
