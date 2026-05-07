<script setup lang="ts">
import { computed, ref } from 'vue'
import { CdxButton, CdxIcon, CdxMessage } from '@wikimedia/codex'
import { cdxIconReload } from '@wikimedia/codex-icons'

import ReviewChangesPlusFeed from '@/imports/fakemediawiki-review-changes-plus/components/ReviewChangesPlusFeed/ReviewChangesPlusFeed.vue'
import {
  PROTO_THANKS_FLOW_REVISIONS_KEY,
  PROTO_THANKS_FLOW_USERNAME_KEY,
  useProtoThanksPatrolRevisions,
} from '@/composables/useProtoThanksPatrolRevisions'
import { thanksModuleFeedProps } from '@/lib/thanksModuleFeedProps'
import { useSkin } from '@/composables/useSkin'
import SpecialPageWrapper from '@/components/SpecialPageWrapper.vue'
import ChromeWrapper from '@/components/ChromeWrapper.vue'

definePage({
  meta: {
    title: 'Thanks module',
    description:
      'Fullscreen thanks patrol module (Review Changes Plus visuals; patrol username is set on the Thanks dashboard).',
  },
})

const {
  fwRevisions,
  loading,
  error,
  refresh,
  didAttemptLiveRefresh,
  lastLiveFetchReturnedNothing,
} = useProtoThanksPatrolRevisions({
  usernameStorageKey: PROTO_THANKS_FLOW_USERNAME_KEY,
  revisionsStorageKey: PROTO_THANKS_FLOW_REVISIONS_KEY,
})

const skin = useSkin()
const isDesktop = computed(() => skin.value === 'desktop')

/** Desktop: title lives in `SpecialPageWrapper`; mobile: keep the feed title row. */
const thanksFeedTitle = computed(() => (isDesktop.value ? '' : thanksModuleFeedProps.title))

const patrolFeedRef = ref<InstanceType<typeof ReviewChangesPlusFeed> | null>(null)

function onPatrolHeaderResetOpened(): void {
  patrolFeedRef.value?.resetOpenedRevisions?.()
}

function onPatrolHeaderRefresh(): void {
  patrolFeedRef.value?.refreshPatrol?.()
}
</script>

<template>
  <ChromeWrapper :show-mobile-last-edited-strip="false">
    <template #footer></template>
    <SpecialPageWrapper class="thanks-module-page" :title="thanksModuleFeedProps.title">
      <template v-if="isDesktop" #actions>
        <span class="thanks-module__sp-actions">
          <CdxButton
            type="button"
            weight="quiet"
            aria-label="Reset which diffs are marked as opened"
            class="review-changes__refresh review-changes__refresh--reset-opened"
            @click="onPatrolHeaderResetOpened"
          >
            <CdxIcon :icon="cdxIconReload" />
          </CdxButton>
          <CdxButton
            type="button"
            weight="quiet"
            aria-label="Refresh"
            class="review-changes__refresh"
            :disabled="loading"
            @click="onPatrolHeaderRefresh"
          >
            <CdxIcon :icon="cdxIconReload" />
          </CdxButton>
        </span>
      </template>

      <div class="thanks-module__body">
        <div class="thanks-module__messages">
          <CdxMessage v-if="error" type="error" :allow-user-dismiss="false">
            {{ error }}
          </CdxMessage>

          <CdxMessage
            v-if="
              !loading &&
              !error &&
              fwRevisions.length === 0 &&
              didAttemptLiveRefresh &&
              lastLiveFetchReturnedNothing
            "
            type="warning"
            :allow-user-dismiss="false"
          >
            No revisions returned.
          </CdxMessage>
        </div>

        <ReviewChangesPlusFeed
          ref="patrolFeedRef"
          v-bind="thanksModuleFeedProps"
          :title="thanksFeedTitle"
          :show-module-border="true"
          protowiki-external-feed
          :protowiki-external-revisions="fwRevisions"
          :protowiki-external-loading="loading"
          :protowiki-show-more-to="null"
          :max-display-revisions="20"
          @protowiki-request-refresh="refresh"
        />
      </div>
    </SpecialPageWrapper>
  </ChromeWrapper>
</template>

<style scoped>
.thanks-module__body {
  min-width: 0;
  padding-bottom: var(--spacing-100, 1rem);
}

.thanks-module__messages {
  padding-inline: var(--spacing-150, 1rem);
}

.thanks-module__sp-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

/* Scoped feed CSS does not reach header actions; mirror ReviewChangesPlusFeed/style.css reset-opened. */
.thanks-module__sp-actions :deep(.review-changes__refresh--reset-opened) {
  color: var(--color-subtle, #a2a9b1);
  opacity: var(--opacity-icon-placeholder, 0.51);
}

.thanks-module__sp-actions :deep(.review-changes__refresh--reset-opened:hover) {
  opacity: var(--opacity-icon-subtle, 0.67);
}

/**
 * Desktop: boxed feed and toolbar in the special-page header.
 * Full 1px frame on the feed; inner list does not add extra top/bottom hairlines.
 */
@media (min-width: 641px) {
  .thanks-module-page :deep(.review-changes__title-row) {
    display: none;
  }

  .thanks-module-page :deep(.special-page-wrapper__header) {
    margin-bottom: var(--spacing-50, 8px);
  }

  .thanks-module-page :deep(.review-changes) {
    border: 1px solid var(--border-color-subtle, #a2a9b1);
    border-radius: 2px;
    box-sizing: border-box;
  }

  .thanks-module-page :deep(.review-changes__feed) {
    border-top: none;
    border-bottom: none;
  }

  .thanks-module__messages {
    padding-inline: 0;
  }
}

/**
 * Mobile: full-bleed module. `SpecialPageWrapper` adds horizontal padding on small viewports
 * (e.g. `[data-skin='mobile'] { padding: 1rem }`) — override with `!important` on the page root.
 */
@media (max-width: 640px) {
  .thanks-module-page.special-page-wrapper {
    box-sizing: border-box;
    max-width: none;
    margin: 0;
    padding: 0 !important;
    padding-top: 0 !important;
  }

  .thanks-module-page :deep(.special-page-wrapper__header) {
    display: none;
  }

  .thanks-module__messages {
    padding-inline: var(--spacing-100, 16px);
  }

  .thanks-module__body {
    padding-bottom: 0;
    background-color: var(--background-color-neutral);
  }

  .thanks-module-page :deep(.review-changes) {
    margin-inline: var(--spacing-25, 4px);
    border: none;
    border-radius: 0;
    box-sizing: border-box;
  }

  .thanks-module-page :deep(.review-changes__feed) {
    padding-left: 0;
    padding-right: 0;
    /* Neutral strip below last card; keep thin — full gutter is the list background. */
    padding-bottom: var(--spacing-25, 4px);
    /* Avoid stacking with footer / chrome top rule (was reading as a double border). */
    border-bottom: none;
  }

  .thanks-module-page :deep(.review-changes__title-row) {
    padding-inline: var(--spacing-100, 16px);
    box-sizing: border-box;
    background-color: var(--background-color-base, #fff);
  }
}
</style>
