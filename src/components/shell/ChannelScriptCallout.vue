<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useServerConfig } from '../../composables/useServerConfig'

/*
 * The command that starts the dashboard channel for a session.
 *
 * On the Agents view this sits on a default surface, so it shows the command
 * by name — "agent-dashboard live", "channel.mjs" — and not the absolute path
 * of the script on this machine, which says nothing the name does not. Copying
 * still copies the full command: that is the action, and it needs the path.
 *
 * The onboarding flow is an explicit setup step where the user is wiring the
 * command up, so it asks for the full path to be shown.
 */
const props = withDefaults(defineProps<{ showFullPath?: boolean }>(), { showFullPath: false })

const WHITESPACE_RE = /\s/
const PATH_SEPARATOR_RE = /[/\\]/

const { scriptPath, loadServerConfig } = useServerConfig()
const copied = ref(false)

onMounted(() => {
  void loadServerConfig()
})

/** The executable's own name plus any arguments: "/a/b/agent-dashboard live" → "agent-dashboard live". */
const commandName = computed(() => {
  const value = scriptPath.value.trim()
  const firstSpace = value.search(WHITESPACE_RE)
  const executable = firstSpace === -1 ? value : value.slice(0, firstSpace)
  const args = firstSpace === -1 ? '' : value.slice(firstSpace)
  const name = executable.split(PATH_SEPARATOR_RE).filter(Boolean).pop() ?? executable
  return `${name}${args}`
})

const shown = computed(() => props.showFullPath ? scriptPath.value : commandName.value)

async function copy() {
  await navigator.clipboard.writeText(scriptPath.value)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}
</script>

<template>
  <div v-if="scriptPath" class="mt-auto pt-6 flex items-center gap-2 text-[11px] text-fg-faint">
    <span class="whitespace-nowrap">Channel command:</span>
    <button
      type="button"
      data-testid="channel-script-path"
      class="font-mono text-[11px] text-fg-mute bg-raised px-2 py-0.5 rounded cursor-pointer select-all transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      :title="copied ? 'Copied!' : 'Click to copy the full command'"
      :aria-label="`Copy channel command ${shown}`"
      @click="copy"
    >
      {{ shown }}
    </button>
    <span v-if="copied" class="text-green-600 dark:text-green-400">Copied!</span>
  </div>
</template>
