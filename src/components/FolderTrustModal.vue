<script setup lang="ts">
import { closeFolderTrust, useSpawnWatch } from '../composables/useSpawnWatch'
import FolderTrustDecision from './FolderTrustDecision.vue'
import AppModal from './ui/AppModal.vue'
import AppModalHeader from './ui/AppModalHeader.vue'

/*
 * Claude's folder trust question, opened from Needs you after the New Agent
 * dialog has closed. It closes by itself once the question is answered or the
 * agent is gone.
 */
const { focusedTrust } = useSpawnWatch()
</script>

<template>
  <AppModal :open="Boolean(focusedTrust?.folderTrust)" width="520px" labelled-by="folder-trust-modal-title" @close="closeFolderTrust">
    <AppModalHeader id="folder-trust-modal-title" title="New agent is waiting" @close="closeFolderTrust" />
    <div class="p-5">
      <FolderTrustDecision v-if="focusedTrust" :spawn="focusedTrust" />
    </div>
  </AppModal>
</template>
