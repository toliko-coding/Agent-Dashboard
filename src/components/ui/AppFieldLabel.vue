<script setup lang="ts">
defineProps<{
  for?: string
}>()
</script>

<template>
  <label
    :for="$props.for"
    class="field-label mb-1.5"
  ><slot /></label>
</template>
