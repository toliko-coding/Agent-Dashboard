<script setup lang="ts">
import type { Freshness } from '../snapshot'
import { computed } from 'vue'
import { formatAge } from '../snapshot'

/*
 * The qualifier a reading carries when it is not simply current.
 *
 * Existed as three identical spans on the LocalScope page and a fourth
 * expression on the Overview, all rendering the same string in the same amber.
 * That flattened two different claims into one appearance:
 *
 *   stale    — this was true, and may not describe the machine now
 *   degraded — this IS current; one source of it had trouble
 *
 * Staleness outranks degradation, which the backend and freshnessNote() both
 * already encode; only the rendering did not. Stale keeps the warning colour
 * because it qualifies the number itself, and degraded is muted because it is
 * a footnote on a reading that is otherwise good. Rendering both as a warning
 * spent the alarm on the smaller problem.
 *
 * Renders nothing at all for a current, complete reading: a badge saying
 * "fine" on every section is noise, and it would make the badges that matter
 * harder to notice.
 */
const props = defineProps<{
  /** Any reading carrying the shared freshness fields. */
  reading: Freshness
  /** Forwarded so a section keeps its own stable test hook. */
  testid?: string
}>()

type Tone = 'stale' | 'degraded'

const tone = computed<Tone | null>(() => {
  if (props.reading.source === 'stale')
    return 'stale'
  if (props.reading.degraded.length > 0)
    return 'degraded'
  return null
})

const text = computed(() => {
  if (tone.value === 'stale') {
    const age = formatAge(props.reading.ageMs)
    return age === null ? 'stale' : `stale · ${age}`
  }
  if (tone.value === 'degraded')
    return `partial · ${props.reading.degraded.map(d => d.source).join(', ')}`
  return ''
})

const toneClass = computed(() =>
  tone.value === 'stale' ? 'text-state-waiting' : 'text-fg-faint')

/*
 * A screen reader gets a sentence rather than the compact label. "stale · 3m
 * ago" is legible next to a heading and meaningless read aloud on its own.
 */
const spokenText = computed(() => {
  if (tone.value === 'stale')
    return `Last reading, ${formatAge(props.reading.ageMs) ?? 'age unknown'}. May be out of date.`
  if (tone.value === 'degraded')
    return `Reduced data from ${props.reading.degraded.map(d => d.source).join(', ')}.`
  return ''
})
</script>

<template>
  <span
    v-if="tone"
    :data-testid="testid"
    :data-freshness="tone"
    class="text-[11px] font-mono"
    :class="toneClass"
  >
    <span aria-hidden="true">{{ text }}</span>
    <span class="sr-only">{{ spokenText }}</span>
  </span>
</template>
