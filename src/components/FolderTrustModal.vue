<script setup lang="ts">
import { computed } from 'vue'
import { closeFolderTrust, useSpawnWatch } from '../composables/useSpawnWatch'
import { useAgents } from '../features/agents'
import FolderTrustDecision from './FolderTrustDecision.vue'
import AppModal from './ui/AppModal.vue'
import AppModalHeader from './ui/AppModalHeader.vue'

/*
 * Claude's folder trust question, opened from Needs you. It reads the
 * server-owned pending list, so it works after a reload and from any tab, and
 * closes by itself once the server no longer sees the question.
 */
const { pendingFolderTrust } = useAgents({ autoStart: false })
const { focusedTrustPid } = useSpawnWatch()
const focused = computed(() => pendingFolderTrust.value.find(t => t.pid === focusedTrustPid.value) ?? null)
</script>

<template>
  <AppModal :open="Boolean(focused)" width="520px" labelled-by="folder-trust-modal-title" @close="closeFolderTrust">
    <AppModalHeader id="folder-trust-modal-title" title="New agent is waiting" @close="closeFolderTrust" />
    <div class="p-5">
      <FolderTrustDecision v-if="focused" :trust="focused" />
    </div>
  </AppModal>
</template>
