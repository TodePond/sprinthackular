<script setup lang="ts">
import ChromeWrapper from '@/components/ChromeWrapper.vue'

definePage({
  meta: {
    title: 'Template: Module',
    description:
      'Fullscreen mobile-style module shell (from FakeMediaWiki ReviewChangesPlus). Empty body.',
  },
})
</script>

<template>
  <ChromeWrapper skin="mobile" :show-mobile-last-edited-strip="false">
    <div class="special-view--review-changes template-module-root">
      <div class="dashboard-slot template-module-root__body" />
    </div>
  </ChromeWrapper>
</template>

<style scoped>
@import './global.css';

.template-module-root {
  width: 100%;
}

.template-module-root__body {
  min-height: 50vh;
  box-sizing: border-box;
}

.dashboard-slot {
  border-radius: 2px;
}
</style>
