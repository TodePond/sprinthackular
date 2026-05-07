<script setup lang="ts">
import { CdxIcon } from '@wikimedia/codex'
import {
  cdxIconArrowNext,
  cdxIconLinkExternal,
} from '@wikimedia/codex-icons'
import { FakeWiki } from 'fakewiki'
import { RouterLink } from 'vue-router'

import ChromeWrapper from '@/components/ChromeWrapper.vue'

definePage({
  meta: {
    title: 'Template: Dashboard',
    description:
      'Personal-dashboard style shell with empty module-shaped slots (from FakeMediaWiki PersonalDashboardPlus).',
  },
})

const wiki = new FakeWiki('https://en.wikipedia.org/', {
  apiUserAgent: 'ProtoWiki/0.1 (https://github.com/wikimedia-research/protowiki) prototype',
})
</script>

<template>
  <ChromeWrapper :show-mobile-last-edited-strip="false">
    <main class="personal-dashboard-clone">
      <div class="dashboard-mobile-banner">
        <a
          :href="wiki.getPageUrl('Wikipedia:Feedback')"
          target="_blank"
          rel="noopener noreferrer"
          class="dashboard-mobile-banner__feedback"
        >
          Share feedback
          <CdxIcon :icon="cdxIconLinkExternal" size="x-small" />
        </a>
      </div>

      <div class="dashboard-mobile-cards">
        <RouterLink to="/template-module" class="mobile-card mobile-card--link">
          <div class="mobile-card__header">
            <span class="mobile-card__title">Primary module slot</span>
            <CdxIcon :icon="cdxIconArrowNext" size="medium" class="mobile-card__arrow" />
          </div>
          <div
            class="mobile-card__content mobile-card__content--preview dashboard-slot dashboard-slot--mobile-primary"
          >
            <!-- Preview / summary lines go here -->
          </div>
          <span class="mobile-card__button">Open fullscreen module</span>
        </RouterLink>

        <section class="mobile-card">
          <div class="mobile-card__header">
            <span class="mobile-card__title">Sidebar module slot</span>
          </div>
          <div
            class="mobile-card__content mobile-card__content--stacked dashboard-slot dashboard-slot--mobile-sidebar"
          />
        </section>

        <a
          :href="wiki.getPageUrl('Wikipedia:List_of_policies')"
          target="_blank"
          rel="noopener noreferrer"
          class="mobile-card mobile-card--link"
        >
          <div class="mobile-card__header">
            <span class="mobile-card__title">Policies slot (example link)</span>
            <CdxIcon :icon="cdxIconArrowNext" size="medium" class="mobile-card__arrow" />
          </div>
          <div class="mobile-card__content">
            <span class="mobile-card__content-text">Replace with your module or keep as link.</span>
          </div>
        </a>
      </div>

      <div class="dashboard-main">
        <div
          class="personal-dashboard-clone__primary dashboard-slot dashboard-slot--desktop-primary"
        />

        <aside class="dashboard-sidebar">
          <section class="sidebar-card dashboard-slot dashboard-slot--desktop-sidebar" />
          <section class="sidebar-card dashboard-slot dashboard-slot--desktop-secondary" />
        </aside>
      </div>
    </main>
  </ChromeWrapper>
</template>

<style scoped>
@import './style.css';
@import './global.css';

.dashboard-slot {
  min-height: 4rem;
  box-sizing: border-box;
}

.dashboard-slot--mobile-primary {
  min-height: 5rem;
}

.personal-dashboard-clone__primary {
  min-height: 12rem;
}
</style>
