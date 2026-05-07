<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { CdxIcon, CdxMessage, CdxProgressBar, CdxTextInput } from '@wikimedia/codex'
import {
  cdxIconArrowNext,
  cdxIconCheck,
  cdxIconHeart,
  cdxIconUserTalk,
} from '@wikimedia/codex-icons'

import ReviewChangesPlusFeed from '@/imports/fakemediawiki-review-changes-plus/components/ReviewChangesPlusFeed/ReviewChangesPlusFeed.vue'
import {
  PROTO_THANKS_FLOW_REVISIONS_KEY,
  PROTO_THANKS_FLOW_USERNAME_KEY,
  useProtoThanksPatrolRevisions,
} from '@/composables/useProtoThanksPatrolRevisions'
import { thanksModuleFeedProps } from '@/lib/thanksModuleFeedProps'
import ChromeWrapper from '@/components/ChromeWrapper.vue'
import SpecialPageWrapper from '@/components/SpecialPageWrapper.vue'

definePage({
  meta: {
    title: 'Thanks dashboard',
    description:
      'Personal dashboard with Impact module and thanks patrol feed (Review Changes Plus visuals, live thanks-patrol data).',
  },
})

const {
  wiki,
  patrolUsernameInput,
  normalizedPatrolUsername,
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

function wikiOriginBase(): string {
  const b = wiki.base.endsWith('/') ? wiki.base.slice(0, -1) : wiki.base
  return b
}

const contributionsUrl = computed(() => {
  const u = normalizedPatrolUsername.value.trim().replace(/ /g, '_')
  return `${wikiOriginBase()}/wiki/Special:Contributions/${encodeURIComponent(u)}`
})

/** Count usercontribs with timestamp ≥ first instant of current UTC month (newest-first scan). */
async function fetchEditsThisMonthCount(username: string): Promise<{ count: number; truncated: boolean }> {
  const monthStartIso = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0),
  ).toISOString()

  let count = 0
  let uccontinue: string | undefined
  const maxBatches = 40
  let truncated = false

  for (let batch = 0; batch < maxBatches; batch++) {
    const params: Record<string, unknown> = {
      list: 'usercontribs',
      ucuser: username,
      uclimit: 'max',
      ucprop: 'timestamp',
    }
    if (uccontinue) params.uccontinue = uccontinue

    const data = (await wiki.request({
      api: 'action',
      params: {
        action: 'query',
        ...params,
      },
    })) as {
      error?: { code?: string; info?: string }
      continue?: { uccontinue?: string }
      query?: { usercontribs?: Array<{ timestamp?: string }> }
    }

    const err = data?.error
    if (err) {
      const code = err.code ?? 'unknown'
      const info = err.info ?? JSON.stringify(err)
      throw new Error(`${code}: ${info}`)
    }

    const contribs = data?.query?.usercontribs ?? []
    for (const c of contribs) {
      const ts = c.timestamp
      if (ts == null || ts === '') continue
      if (ts < monthStartIso) {
        return { count, truncated: false }
      }
      count++
    }

    const next = data?.continue?.uccontinue
    if (!next) break
    if (batch === maxBatches - 1) {
      truncated = true
      break
    }
    uccontinue = next
  }
  return { count, truncated }
}

const editsThisMonthCount = ref<number | null>(null)
const editsThisMonthTruncated = ref(false)
const editsMonthLoading = ref(false)

const thanksLogUrl = computed(() => {
  const base = wiki.base.endsWith('/') ? wiki.base : `${wiki.base}/`
  const u = normalizedPatrolUsername.value
  return `${base}w/index.php?title=Special%3ALog&type=thanks&user=${encodeURIComponent(u)}`
})

/** Thanks log count via Action API (paginated; may show “n+” if capped). */
const thanksGivenCount = ref<number | null>(null)
const thanksGivenTruncated = ref(false)
const thanksCountLoading = ref(false)

const THANKS_LOG_COUNT_MAX_BATCHES = 50

async function fetchThanksGivenCount(username: string): Promise<{ count: number; truncated: boolean }> {
  let total = 0
  let lecontinue: string | undefined
  let truncated = false
  for (let batch = 0; batch < THANKS_LOG_COUNT_MAX_BATCHES; batch++) {
    const params: Record<string, unknown> = {
      list: 'logevents',
      letype: 'thanks',
      leuser: username,
      lelimit: 'max',
    }
    if (lecontinue) params.lecontinue = lecontinue

    const data = (await wiki.request({
      api: 'action',
      params: {
        action: 'query',
        ...params,
      },
    })) as {
      continue?: { lecontinue?: string }
      query?: { logevents?: unknown[] }
    }

    const events = data?.query?.logevents ?? []
    total += events.length

    const next = data?.continue?.lecontinue
    if (!next) break
    if (batch === THANKS_LOG_COUNT_MAX_BATCHES - 1) {
      truncated = true
      break
    }
    lecontinue = next
  }
  return { count: total, truncated }
}

watch(
  normalizedPatrolUsername,
  async (username) => {
    thanksCountLoading.value = true
    editsMonthLoading.value = true
    thanksGivenCount.value = null
    thanksGivenTruncated.value = false
    editsThisMonthCount.value = null
    editsThisMonthTruncated.value = false

    const [thanksOutcome, editsOutcome] = await Promise.allSettled([
      fetchThanksGivenCount(username),
      fetchEditsThisMonthCount(username),
    ])

    if (thanksOutcome.status === 'fulfilled') {
      thanksGivenCount.value = thanksOutcome.value.count
      thanksGivenTruncated.value = thanksOutcome.value.truncated
    } else {
      thanksGivenCount.value = null
    }
    thanksCountLoading.value = false

    if (editsOutcome.status === 'fulfilled') {
      editsThisMonthCount.value = editsOutcome.value.count
      editsThisMonthTruncated.value = editsOutcome.value.truncated
    } else {
      editsThisMonthCount.value = null
    }
    editsMonthLoading.value = false
  },
  { immediate: true },
)

const thanksGivenDisplay = computed(() => {
  if (thanksCountLoading.value) return '…'
  if (thanksGivenCount.value == null) return '—'
  const n = thanksGivenCount.value.toLocaleString()
  return thanksGivenTruncated.value ? `${n}+` : n
})

const editsThisMonthDisplay = computed(() => {
  if (editsMonthLoading.value) return '…'
  if (editsThisMonthCount.value == null) return '—'
  const n = editsThisMonthCount.value.toLocaleString()
  return editsThisMonthTruncated.value ? `${n}+` : n
})

function joinOxfordList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Mobile card: two pages × up to three distinct editors each (newest-first in patrol data). */
const MOBILE_PATROL_SUMMARY_MAX_PAGES = 2
const MOBILE_PATROL_SUMMARY_EDITORS_PER_PAGE = 3
const MOBILE_PATROL_SUMMARY_ROW_CAP = 80

function pageKeyForMatch(title: string): string {
  return title.trim().toLowerCase()
}

function parseRevisionTimeMs(timestamp: string | undefined): number {
  if (timestamp == null || timestamp === '') return 0
  const n = new Date(timestamp).getTime()
  return Number.isNaN(n) ? 0 : n
}

type ThanksPatrolPreviewEntry =
  | { kind: 'editors'; editorsText: string; pageTitle: string }
  | { kind: 'message'; text: string }

const mobileThanksPatrolPreviewEntries = computed((): ThanksPatrolPreviewEntry[] => {
  if (loading.value && fwRevisions.value.length === 0) return []

  const rows = [...fwRevisions.value]
    .slice(0, MOBILE_PATROL_SUMMARY_ROW_CAP)
    .sort((a, b) => parseRevisionTimeMs(b.timestamp) - parseRevisionTimeMs(a.timestamp))

  if (rows.length === 0) {
    if (loading.value) return []
    return [{ kind: 'message', text: 'No recent edits in scope.' }]
  }

  const pageOrder: string[] = []
  const seenPageKeys = new Set<string>()
  for (const r of rows) {
    const p = (r.pageName ?? '').trim()
    if (!p) continue
    const k = pageKeyForMatch(p)
    if (seenPageKeys.has(k)) continue
    seenPageKeys.add(k)
    pageOrder.push(p)
  }

  const selectedPages = pageOrder.slice(0, MOBILE_PATROL_SUMMARY_MAX_PAGES)
  const entries: ThanksPatrolPreviewEntry[] = []

  for (const page of selectedPages) {
    const pk = pageKeyForMatch(page)
    const editors: string[] = []
    const seenEditors = new Set<string>()
    for (const r of rows) {
      if (pageKeyForMatch((r.pageName ?? '').trim()) !== pk) continue
      const n = (r.user?.name ?? '').trim()
      if (!n || seenEditors.has(n)) continue
      seenEditors.add(n)
      editors.push(n)
      if (editors.length >= MOBILE_PATROL_SUMMARY_EDITORS_PER_PAGE) break
    }
    if (editors.length === 0) continue
    entries.push({
      kind: 'editors',
      editorsText: joinOxfordList(editors),
      pageTitle: page,
    })
  }

  if (entries.length === 0) return [{ kind: 'message', text: 'No recent edits in scope.' }]
  return entries
})
</script>

<template>
  <ChromeWrapper :show-mobile-last-edited-strip="false">
    <SpecialPageWrapper class="thanks-dashboard-page" title="Homepage">
      <main class="personal-dashboard-clone">
        <div class="thanks-dashboard__pages-field">
          <label class="thanks-dashboard__pages-label">
            <span class="thanks-dashboard__pages-label-text">Username</span>
            <CdxTextInput
              v-model="patrolUsernameInput"
              placeholder="Wikipedia username — patrol scans last ~100 mainspace contribs (up to 12 pages)"
            />
          </label>
        </div>

        <CdxMessage v-if="error" type="error" :allow-user-dismiss="false">
          {{ error }}
        </CdxMessage>

        <div class="dashboard-mobile-cards">
          <RouterLink
            to="/thanks-module"
            class="mobile-card mobile-card--link"
            aria-label="Open Thanks patrol in the fullscreen module"
          >
            <div class="mobile-card__header">
              <span class="mobile-card__title">{{ thanksModuleFeedProps.title }}</span>
              <CdxIcon :icon="cdxIconArrowNext" size="medium" class="mobile-card__arrow" />
            </div>
            <div class="mobile-card__content mobile-card__content--preview">
              <template v-if="loading && fwRevisions.length === 0">
                <CdxProgressBar inline />
              </template>
              <template v-else>
                <template v-for="(entry, idx) in mobileThanksPatrolPreviewEntries" :key="idx">
                  <span
                    v-if="entry.kind === 'message'"
                    class="mobile-card__content-text thanks-dashboard__patrol-preview-row"
                  >{{ entry.text }}</span>
                  <div
                    v-else
                    class="thanks-dashboard__patrol-preview-row thanks-dashboard__patrol-preview-row--with-icon"
                  >
                    <CdxIcon
                      :icon="cdxIconHeart"
                      size="small"
                      class="thanks-dashboard__patrol-preview-heart"
                      aria-hidden="true"
                    />
                    <span class="mobile-card__content-text thanks-dashboard__patrol-preview-text">
                      {{ entry.editorsText }} edited
                      <strong class="thanks-dashboard__patrol-preview-page">{{ entry.pageTitle }}</strong>.
                    </span>
                  </div>
                </template>
              </template>
            </div>
          </RouterLink>

          <section class="mobile-card">
            <div class="mobile-card__header">
              <span class="mobile-card__title">Your impact</span>
            </div>
            <div class="mobile-card__content mobile-card__content--stacked">
              <div class="mobile-card__stat">
                <CdxIcon :icon="cdxIconUserTalk" size="small" class="mobile-card__stat-icon" />
                <a
                  :href="thanksLogUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mobile-card__stat-link"
                  >{{ thanksGivenDisplay }}</a
                >
                <span>Thanks sent.</span>
              </div>
              <div class="mobile-card__stat">
                <CdxIcon :icon="cdxIconCheck" size="small" class="mobile-card__stat-icon" />
                <a
                  :href="contributionsUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mobile-card__stat-link"
                  >{{ editsThisMonthDisplay }}</a
                >
                <span>Edits this month.</span>
              </div>
            </div>
          </section>
        </div>

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

        <div class="dashboard-main">
          <ReviewChangesPlusFeed
            v-bind="thanksModuleFeedProps"
            protowiki-external-feed
            :protowiki-external-revisions="fwRevisions"
            :protowiki-external-loading="loading"
            protowiki-show-more-to="/thanks-module"
            :max-display-revisions="6"
            class="thanks-dashboard__feed"
            @protowiki-request-refresh="refresh"
          />

          <aside class="dashboard-sidebar">
            <section class="sidebar-card your-impact">
              <div class="sidebar-card__title">Your impact</div>
              <div class="your-impact__metrics">
                <div class="your-impact__metric">
                  <div class="your-impact__value-row">
                    <CdxIcon :icon="cdxIconUserTalk" class="your-impact__icon" />
                    <a
                      :href="thanksLogUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="your-impact__value your-impact__value-link"
                      >{{ thanksGivenDisplay }}</a
                    >
                  </div>
                  <span class="your-impact__label">Thanks sent</span>
                </div>
                <div class="your-impact__divider" aria-hidden="true" />
                <div class="your-impact__metric">
                  <div class="your-impact__value-row">
                    <CdxIcon :icon="cdxIconCheck" class="your-impact__icon" />
                    <a
                      :href="contributionsUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="your-impact__value your-impact__value-link"
                      >{{ editsThisMonthDisplay }}</a
                    >
                  </div>
                  <span class="your-impact__label">Edits this month</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </SpecialPageWrapper>
  </ChromeWrapper>
</template>

<style scoped>
@import '../template-dashboard/style.css';
@import '../template-dashboard/global.css';

.personal-dashboard-clone {
  box-sizing: border-box;
  /* Horizontal inset comes from `SpecialPageWrapper`; avoid double padding. */
  padding-inline: 0;
  padding-bottom: var(--spacing-100, 1rem);
}

.thanks-dashboard__pages-field {
  margin-block-end: var(--spacing-100, 1rem);
}

.thanks-dashboard__pages-label {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-35, 6px);
  font-size: var(--font-size-medium, 1rem);
  color: var(--color-base, #202122);
}

.thanks-dashboard__pages-label-text {
  font-weight: var(--font-weight-bold, 700);
}

.personal-dashboard-clone .thanks-dashboard__feed.review-changes {
  min-width: 0;
  border: 1px solid var(--border-color-subtle, #a2a9b1);
  border-radius: 2px;
}

.thanks-dashboard__patrol-preview-row {
  display: block;
}

.thanks-dashboard__patrol-preview-row + .thanks-dashboard__patrol-preview-row {
  margin-top: var(--spacing-50, 8px);
}

.thanks-dashboard__patrol-preview-row--with-icon {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-50, 8px);
}

.thanks-dashboard__patrol-preview-heart {
  flex-shrink: 0;
  margin-top: 0.1em;
  color: var(--color-base--subtle, #54595d);
}

.thanks-dashboard__patrol-preview-text {
  flex: 1 1 auto;
  min-width: 0;
}

.thanks-dashboard__patrol-preview-page {
  font-weight: var(--font-weight-bold, 700);
}
</style>
