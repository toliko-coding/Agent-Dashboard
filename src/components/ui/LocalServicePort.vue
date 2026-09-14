<script setup lang="ts">
import type { LocalServiceEndpoint } from '@/utils/localServiceUrl'
import { computed } from 'vue'
import { localServiceUrl } from '@/utils/localServiceUrl'

/*
 * A listening port LocalScope observed, as the one port pill every Runtime
 * surface draws (3N.2.3): Runtime → Services, and the workspace topology on
 * Runtime → Workspaces and Command.
 *
 * When localServiceUrl gives the observation an address — http(s)://localhost
 * and the validated port, never the bind address or a service-supplied string
 * — the pill is a link that opens it in a new tab. Otherwise (UDP, an invalid
 * port, a listener bound only to another network address) it stays plain text.
 * Subtle on purpose: a port is structure, and the link only says "you can go
 * there", not that the service is healthy.
 */
const props = withDefaults(defineProps<{
  service: LocalServiceEndpoint & { port: number }
  size?: 'md' | 'sm'
  testid?: string
}>(), { size: 'md', testid: 'service-port' })

const href = computed(() => localServiceUrl(props.service))

const SIZE = {
  md: 'px-2 py-0.5 text-ui-sm font-semibold',
  sm: 'px-1.5 text-label',
} as const
</script>

<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="group inline-flex cursor-pointer items-center gap-1 rounded-full border border-line font-mono tabular-nums text-fg no-underline transition-colors hover:border-state-live/60 hover:text-live-text focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent motion-reduce:transition-none"
    :class="SIZE[size]"
    :aria-label="`Open localhost port ${service.port}`"
    :title="`Open localhost:${service.port}`"
    :data-testid="testid"
    data-actionable="true"
  >:{{ service.port }}<svg viewBox="0 0 12 12" class="size-2.5 shrink-0 text-fg-mute transition-colors group-hover:text-live-text motion-reduce:transition-none" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4.5 2.5h5v5M9.5 2.5 3 9" /></svg></a>
  <span
    v-else
    class="inline-flex items-center rounded-full border border-line font-mono tabular-nums text-fg-soft"
    :class="SIZE[size]"
    :data-testid="testid"
  >:{{ service.port }}</span>
</template>
