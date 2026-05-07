<script setup lang="ts">
import { FakeWiki, type FWUserInfo } from 'fakewiki'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { CdxButton, CdxMessage, CdxTextInput } from '@wikimedia/codex'

import ChromeWrapper from '@/components/ChromeWrapper.vue'
import SpecialPageWrapper from '@/components/SpecialPageWrapper.vue'
import { insertColonAfterSectionAutocommentInWikitext } from '@/lib/insertColonAfterSectionAutocommentInWikitext'
import { removeHeartConfettiLayers, spawnHeartConfettiFromButton } from '@/lib/protowikiHeartConfetti'

definePage({
  meta: {
    title: 'Thanks patrol',
    description:
      'Edits that could do with some thanks.',
  },
})

const API_UA = 'ProtoWiki/0.1 (https://github.com/wikimedia-research/protowiki) prototype'

const wiki = new FakeWiki('https://en.wikipedia.org/', { apiUserAgent: API_UA })
/** Propagates to Action API and REST (edit summaries). */

const WIKI_ORIGIN = new URL(wiki.base).origin

function revisionPermalink(revid: number): string {
  return `${WIKI_ORIGIN}/wiki/Special:PermanentLink/${revid}`
}

function userPageUrl(username: string): string {
  return `${WIKI_ORIGIN}/wiki/User:${username.trim().replace(/ /g, '_')}`
}

function articleUrl(title: string): string {
  const segment = title.trim().replace(/ /g, '_')
  return `${WIKI_ORIGIN}/wiki/${encodeURIComponent(segment)}`
}

/** Same geometry as Codex `cdxIconHeart`, inlined so the default is a stroked outline (not a filled glyph). */
const PROTOWIKI_THANKS_HEART_PATH_D =
  'M14.75 1A5.24 5.24 0 0010 4 5.24 5.24 0 000 6.25C0 11.75 10 19 10 19s10-7.25 10-12.75A5.25 5.25 0 0014.75 1'

const thankedRevKeys = ref<Set<string>>(new Set())

function thanksKey(r: RevisionRow): string {
  return `${r.articleTitle}:${r.revid}`
}

function isThanked(r: RevisionRow): boolean {
  return thankedRevKeys.value.has(thanksKey(r))
}

function onThanksHeartClick(ev: MouseEvent, r: RevisionRow): void {
  const el = ev.currentTarget
  if (!(el instanceof HTMLElement)) return
  const k = thanksKey(r)
  const was = thankedRevKeys.value.has(k)
  const next = new Set(thankedRevKeys.value)
  if (was) {
    next.delete(k)
  } else {
    next.add(k)
    spawnHeartConfettiFromButton(el, {
      colorVar: '--color-destructive',
      colorFallback: '#bf3c2c',
    })
  }
  thankedRevKeys.value = next
}

/** Default articles when the input is empty or whitespace-only. */
const DEFAULT_PAGE_TITLES = [
  'Wet Leg',
  'Confidence Man (band)',
  'Jade Thirlwall',
  'Little Mix',
] as const

const PAGES_LIST_STORAGE_KEY = 'protowiki-thanks-patrol-pages'

function loadPagesInputFromStorage(): string {
  try {
    const s = localStorage.getItem(PAGES_LIST_STORAGE_KEY)
    if (s != null && s.trim()) return s
  } catch {
    /* ignore */
  }
  return DEFAULT_PAGE_TITLES.join(', ')
}

function savePagesInputToStorage(raw: string): void {
  try {
    localStorage.setItem(PAGES_LIST_STORAGE_KEY, raw)
  } catch {
    /* quota / privacy mode */
  }
}

function parseCommaSeparatedTitles(raw: string): string[] {
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

const pagesInputText = ref(loadPagesInputFromStorage())

const activePageTitles = computed(() => {
  const parsed = parseCommaSeparatedTitles(pagesInputText.value)
  return parsed.length > 0 ? parsed : [...DEFAULT_PAGE_TITLES]
})

const patrolScopeLabel = computed(() => activePageTitles.value.join('; '))

/** Max rows after merging all pages (no separate “pool” fetch). */
const REVISION_LIMIT = 80
/**
 * Registered editors with **more than** this many edits are excluded (included range is 0–100).
 * IPs skip this check when the API does not return an edit count.
 */
const MAX_EDIT_COUNT_FOR_LIST = 100

const STORAGE_KEY = 'protowiki-thanks-patrol-revisions'
const CACHE_VERSION = 11 as const

interface RevisionRow {
  /** Article this revision belongs to (for links + summary transform context). */
  articleTitle: string
  revid: number
  parentid: number
  user: string
  userid?: number
  timestamp: string
  comment?: string
  parsedcomment?: string
  minor?: boolean
  /** Bot-flag or bot group — cheap summary only, faded. Temporary accounts are omitted entirely. */
  dimmed?: boolean
  /** MediaWiki HTML from `wiki.getEditSummaryHtml` (or API `parsedcomment` fallback). */
  summaryHtml?: string
  /** True when there was no summary text to show. */
  summaryPlaceholder?: boolean
}

interface ThanksPatrolCache {
  v: typeof CACHE_VERSION
  title: string
  revisions: RevisionRow[]
}

/** Raw revision from `prop=revisions`. */
interface WikiRevisionRaw {
  revid?: number
  parentid?: number
  user?: string
  userid?: number
  timestamp?: string
  comment?: string
  parsedcomment?: string
  minor?: boolean | string
  bot?: boolean | string
  anon?: boolean | string
}

const revisions = ref<RevisionRow[]>([])
const pageTitleResolved = ref(patrolScopeLabel.value)
const loading = ref(false)
const error = ref<string | null>(null)
/** Set after a live Refresh attempt finishes (success or failure). */
const didAttemptLiveRefresh = ref(false)
/** True only after a successful live fetch that returned zero rows. */
const lastLiveFetchReturnedNothing = ref(false)
/** Bumped on an interval so relative timestamps recompute. */
const relativeTimeTick = ref(0)

watch(pagesInputText, (v) => savePagesInputToStorage(v))

watch(patrolScopeLabel, (next, prev) => {
  if (prev === undefined) return
  if (next === prev) return
  revisions.value = []
  pageTitleResolved.value = next
  didAttemptLiveRefresh.value = false
  lastLiveFetchReturnedNothing.value = false
  error.value = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
})

function formatNiceRelative(iso: string): string {
  void relativeTimeTick.value
  return wiki.formatNiceRelativeTimestamp(iso)
}

function parseEditSummary(comment: string | undefined): string {
  const c = (comment ?? '').trim()
  const m = c.match(/^\s*\/\*\s*([^*]+?)\s*\*\/\s*(.*)$/s)
  if (m) {
    const section = m[1].trim()
    const rest = m[2].trim()
    const arrow = `→ ${section}`
    return rest.length ? `${arrow}: ${rest}` : arrow
  }
  return c.length ? c : '(no summary)'
}

function escapeHtml(text: string): string {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

function exceedsPatrolEditLimit(editcount: unknown): boolean {
  return (
    typeof editcount === 'number' &&
    !Number.isNaN(editcount) &&
    editcount > MAX_EDIT_COUNT_FOR_LIST
  )
}

/** fakewiki wraps summaries as "(" + wikitext + ")" before REST transform — strip that outer pair in HTML. */
function stripOuterParenWrap(innerHtml: string): string | null {
  const s = innerHtml.trim()
  if (!s.startsWith('(')) return null
  let depth = 1
  let i = 1
  while (i < s.length && depth > 0) {
    const c = s[i]
    if (c === '<') {
      const gt = s.indexOf('>', i)
      if (gt === -1) return null
      i = gt + 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  if (depth !== 0 || i !== s.length) return null
  return s.slice(1, i - 1).trim()
}

function stripFakewikiSummaryParentheses(html: string): string {
  const trimmed = html.trim()
  const wrapper = document.createElement('div')
  wrapper.innerHTML = trimmed
  const p = wrapper.querySelector('p')
  if (p) {
    const stripped = stripOuterParenWrap(p.innerHTML)
    if (stripped !== null) {
      p.innerHTML = stripped
      return wrapper.innerHTML.trim()
    }
  }
  const plain = stripOuterParenWrap(trimmed)
  if (plain !== null && !trimmed.includes('<')) {
    return plain
  }
  return trimmed
}

/**
 * Summary without REST transform — for dimmed rows (bots / temps / flagged IPs)
 * so we avoid `getEditSummaryHtml` on edits outside the thanks patrol target set.
 */
function buildSummaryHtmlWithoutTransform(r: RevisionRow): {
  html: string
  placeholder: boolean
} {
  const c = (r.comment ?? '').trim()
  if (!c) {
    if (r.parsedcomment?.trim()) {
      return { html: r.parsedcomment, placeholder: false }
    }
    return {
      html: '<span class="thanks-patrol__summary-placeholder">(no summary)</span>',
      placeholder: true,
    }
  }
  const plain = parseEditSummary(r.comment)
  return {
    html: `<span>${escapeHtml(plain)}</span>`,
    placeholder: plain === '(no summary)',
  }
}

/**
 * Render summary wikitext via fakewiki (`preprocessEditSummary` + REST transform).
 * Falls back to Action API `parsedcomment` when there is no raw `comment` wikitext.
 */
async function buildSummaryHtml(
  r: RevisionRow,
  pageTitle: string,
): Promise<{ html: string; placeholder: boolean }> {
  const c = (r.comment ?? '').trim()
  if (!c) {
    if (r.parsedcomment?.trim()) {
      return { html: r.parsedcomment, placeholder: false }
    }
    return {
      html: '<span class="thanks-patrol__summary-placeholder">(no summary)</span>',
      placeholder: true,
    }
  }
  try {
    const html = await wiki.getEditSummaryHtml(
      insertColonAfterSectionAutocommentInWikitext(c),
      pageTitle,
    )
    return { html: stripFakewikiSummaryParentheses(html), placeholder: false }
  } catch {
    const plain = parseEditSummary(r.comment)
    return {
      html: `<span>${escapeHtml(plain)}</span>`,
      placeholder: plain === '(no summary)',
    }
  }
}

async function enrichSummariesInPlace(): Promise<void> {
  const rows = revisions.value
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const built = r.dimmed
      ? buildSummaryHtmlWithoutTransform(r)
      : await buildSummaryHtml(r, r.articleTitle)
    const patch: RevisionRow = {
      ...r,
      summaryHtml: built.html,
      summaryPlaceholder: built.placeholder,
    }
    revisions.value = revisions.value.map((row, j) => (j === i ? patch : row))
  }
}

function revisionMarkedBot(r: WikiRevisionRaw): boolean {
  return Boolean(r.bot)
}

function revisionIsIpAnon(r: WikiRevisionRaw): boolean {
  return Boolean(r.anon)
}

function isBotAccount(u: FWUserInfo): boolean {
  const g = [...(u.groups ?? []), ...(u.implicitgroups ?? [])]
  return g.includes('bot')
}

/** `tempexpired` is returned for temporary accounts (see API:Users). */
function isTemporaryAccount(u: FWUserInfo): boolean {
  return typeof u.tempexpired === 'boolean'
}

/** Temporary-account auto-names often start with `~` when metadata is incomplete. */
function isTemporaryPatrolUsername(username: string): boolean {
  return username.startsWith('~')
}

/** Action API via fakewiki (`formatversion=2` applied by the client). */
async function wikiActionQuery(params: Record<string, unknown>): Promise<any> {
  return wiki.request({
    api: 'action',
    params: {
      action: 'query',
      ...params,
    },
  })
}

function firstQueryPage(data: any): {
  title?: string
  missing?: boolean | string
  revisions?: WikiRevisionRaw[]
} | undefined {
  const pages = data?.query?.pages
  if (pages == null) return undefined
  const list = Array.isArray(pages) ? pages : Object.values(pages as Record<string, unknown>)
  const first = list[0] as { title?: string; missing?: boolean | string; revisions?: WikiRevisionRaw[] }
  return first
}

/** Batched `list=users` via `FakeWiki.getUsersInfo` (groups, tempexpired, etc.). */
async function fetchUsersByName(names: string[]): Promise<Map<string, FWUserInfo>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (unique.length === 0) return new Map()
  const record = await wiki.getUsersInfo(unique)
  const map = new Map<string, FWUserInfo>()
  for (const name of unique) {
    const u = record[name]
    if (u?.name && !u.invalid && !u.missing) map.set(u.name, u)
  }
  return map
}

function normalizeRevision(r: WikiRevisionRaw): Omit<RevisionRow, 'articleTitle'> | null {
  const revid = r.revid
  if (revid == null) return null
  return {
    revid,
    parentid: r.parentid ?? 0,
    user: (r.user ?? '').trim(),
    userid: r.userid,
    timestamp: r.timestamp ?? '',
    comment: r.comment,
    parsedcomment: r.parsedcomment,
    minor: Boolean(r.minor),
  }
}

function parseWikiTimestamp(iso: string | undefined): number {
  if (iso == null || iso === '') return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

function mergeRevisionListsDescending(
  chunks: Array<{ raw: WikiRevisionRaw; articleTitle: string }>,
): Array<{ raw: WikiRevisionRaw; articleTitle: string }> {
  return [...chunks].sort(
    (a, b) => parseWikiTimestamp(b.raw.timestamp) - parseWikiTimestamp(a.raw.timestamp),
  )
}

/**
 * Latest revisions across the configured articles, merged newest-first, capped at
 * {@link REVISION_LIMIT}. Omits invalid users, editors with more than
 * {@link MAX_EDIT_COUNT_FOR_LIST} edits, and temporary accounts; bots use `dimmed`.
 */
async function fetchFilteredRevisions(): Promise<{ title: string; list: RevisionRow[] }> {
  const mergedChunks: Array<{ raw: WikiRevisionRaw; articleTitle: string }> = []

  for (const articleTitle of activePageTitles.value) {
    const data = await wikiActionQuery({
      titles: articleTitle,
      prop: 'revisions',
      rvlimit: REVISION_LIMIT,
      rvprop: 'ids|timestamp|user|userid|comment|parsedcomment|flags',
    })
    const page = firstQueryPage(data)
    if (!page) continue
    if (page.missing != null && page.missing !== false) continue

    const resolvedTitle = page.title ?? articleTitle
    const rawList = page.revisions ?? []
    for (const raw of rawList) {
      mergedChunks.push({ raw, articleTitle: resolvedTitle })
    }
  }

  const pool = mergeRevisionListsDescending(mergedChunks).slice(0, REVISION_LIMIT)

  const namesForLookup = pool.map(({ raw }) => (raw.user ?? '').trim()).filter(Boolean)
  const userMap = await fetchUsersByName(namesForLookup)

  const list: RevisionRow[] = []

  for (const { raw, articleTitle } of pool) {
    const base = normalizeRevision(raw)
    if (!base) continue

    const row: RevisionRow = { ...base, articleTitle }

    if (revisionIsIpAnon(raw)) {
      const ip = (raw.user ?? '').trim()
      if (!ip) continue
      const uIp = userMap.get(ip)
      if (uIp && exceedsPatrolEditLimit(uIp.editcount)) continue
      row.dimmed = revisionMarkedBot(raw)
      list.push(row)
      continue
    }

    const username = (raw.user ?? '').trim()
    if (!username) continue
    if (isTemporaryPatrolUsername(username)) continue

    const u = userMap.get(username)
    if (!u || u.missing || u.invalid) continue
    if (exceedsPatrolEditLimit(u.editcount)) continue
    if (isTemporaryAccount(u)) continue

    row.dimmed = revisionMarkedBot(raw) || isBotAccount(u)
    list.push(row)
  }

  return { title: patrolScopeLabel.value, list }
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as ThanksPatrolCache
    if (parsed.v !== CACHE_VERSION || !Array.isArray(parsed.revisions)) return
    const expectedScope = patrolScopeLabel.value
    const cachedTitle =
      typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : ''
    if (cachedTitle !== expectedScope) return
    pageTitleResolved.value = cachedTitle
    revisions.value = parsed.revisions
    relativeTimeTick.value += 1
  } catch {
    // Corrupt or unreadable cache — ignore
  }
}

function saveToStorage(title: string, list: RevisionRow[]): void {
  try {
    const payload: ThanksPatrolCache = {
      v: CACHE_VERSION,
      title,
      revisions: list,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota or privacy mode — ignore
  }
}

async function refresh() {
  error.value = null
  loading.value = true
  lastLiveFetchReturnedNothing.value = false
  try {
    const { title, list } = await fetchFilteredRevisions()
    pageTitleResolved.value = title
    revisions.value = list
    lastLiveFetchReturnedNothing.value = list.length === 0
    relativeTimeTick.value += 1
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
    didAttemptLiveRefresh.value = true
  }

  if (!error.value && revisions.value.length > 0) {
    try {
      await enrichSummariesInPlace()
    } catch {
      /* partial summaries */
    }
    saveToStorage(pageTitleResolved.value, revisions.value)
  }
}

let relativeTimeInterval: ReturnType<typeof setInterval> | undefined

onMounted(async () => {
  loadFromStorage()
  const needsSummaries =
    revisions.value.length > 0 &&
    revisions.value.some((r) => r.summaryHtml == null || r.summaryHtml === '')
  if (needsSummaries) {
    try {
      await enrichSummariesInPlace()
      saveToStorage(pageTitleResolved.value, revisions.value)
    } catch {
      /* partial summaries */
    }
  }
  relativeTimeInterval = window.setInterval(() => {
    relativeTimeTick.value += 1
  }, 60_000)
})

onUnmounted(() => {
  if (relativeTimeInterval != null) window.clearInterval(relativeTimeInterval)
  removeHeartConfettiLayers()
})
</script>

<template>
  <ChromeWrapper>
    <SpecialPageWrapper title="Thanks patrol">
      <template #actions>
        <CdxButton action="progressive" type="button" :disabled="loading" @click="refresh">
          Refresh
        </CdxButton>
      </template>

      <div class="thanks-patrol__pages-field">
        <label class="thanks-patrol__pages-label">
          <span class="thanks-patrol__pages-label-text">Articles to patrol</span>
          <CdxTextInput
            v-model="pagesInputText"
            placeholder="Article title, Another article, …"
          />
        </label>
        <!-- <p class="thanks-patrol__pages-hint">
          Comma-separated page titles. Saved in local storage. If the field is empty, the default
          demo articles are used.
        </p> -->
      </div>

      <CdxMessage v-if="error" type="error" :allow-user-dismiss="false">
        {{ error }}
      </CdxMessage>

      <CdxMessage
        v-if="
          !loading &&
          !error &&
          revisions.length === 0 &&
          !didAttemptLiveRefresh
        "
        type="notice"
        :allow-user-dismiss="false"
      >
        Press <strong>Refresh</strong> to load edits.
      </CdxMessage>

      <CdxMessage
        v-if="
          !loading &&
          !error &&
          revisions.length === 0 &&
          didAttemptLiveRefresh &&
          lastLiveFetchReturnedNothing
        "
        type="warning"
        :allow-user-dismiss="false"
      >
        No revisions returned.
      </CdxMessage>

      <ul v-if="revisions.length" class="thanks-patrol__list">
        <li
          v-for="(r, idx) in revisions"
          :key="`${r.articleTitle}:${r.revid}`"
          class="thanks-patrol__row"
          :class="{ 'thanks-patrol__row--dimmed': r.dimmed }"
        >
          <div class="thanks-patrol__card-layout">
            <div class="thanks-patrol__card-main">
              <p class="thanks-patrol__article-line">
                <a
                  class="thanks-patrol__article-link"
                  :href="articleUrl(r.articleTitle)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ r.articleTitle }}
                </a>
              </p>
              <p class="thanks-patrol__meta thanks-patrol__card-header">
                <a
                  v-if="r.user"
                  class="thanks-patrol__meta-link"
                  :href="userPageUrl(r.user)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ r.user }}
                </a>
                <template v-else>(unknown)</template>
                <span class="thanks-patrol__sep" aria-hidden="true">·</span>
                <a
                  class="thanks-patrol__meta-time"
                  :href="revisionPermalink(r.revid)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <time :datetime="r.timestamp" :title="r.timestamp">{{
                    formatNiceRelative(r.timestamp)
                  }}</time>
                </a>
              </p>
              <p
                class="thanks-patrol__summary thanks-patrol__card-body"
                :class="{ 'thanks-patrol__card-body--placeholder': r.summaryPlaceholder }"
              >
                <div
                  v-if="r.summaryHtml"
                  class="thanks-patrol__summary-html"
                  v-html="r.summaryHtml"
                />
                <span v-else class="thanks-patrol__summary-pending" aria-hidden="true">&nbsp;</span>
              </p>
            </div>
            <div class="thanks-patrol__card-actions">
              <CdxButton
                weight="quiet"
                size="small"
                type="button"
                :class="[
                  'thanks-patrol__heart-btn',
                  isThanked(r) ? 'thanks-patrol__heart-btn--filled' : 'thanks-patrol__heart-btn--outline',
                ]"
                :aria-pressed="isThanked(r) ? 'true' : 'false'"
                :aria-label="isThanked(r) ? 'Remove thanks' : 'Give thanks'"
                @click="onThanksHeartClick($event, r)"
              >
                <span class="thanks-patrol__heart-glyph" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20">
                    <path
                      :d="PROTOWIKI_THANKS_HEART_PATH_D"
                      :fill="isThanked(r) ? 'currentColor' : 'none'"
                      :stroke="isThanked(r) ? 'none' : 'currentColor'"
                      stroke-width="1.15"
                      stroke-linejoin="round"
                      vector-effect="non-scaling-stroke"
                    />
                  </svg>
                </span>
              </CdxButton>
            </div>
          </div>
          <hr v-if="idx < revisions.length - 1" class="thanks-patrol__hr" />
        </li>
      </ul>
    </SpecialPageWrapper>
  </ChromeWrapper>
</template>

<style scoped>
.thanks-patrol__pages-field {
  margin-block-end: var(--spacing-100, 1rem);
}

.thanks-patrol__pages-label {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-35, 6px);
  font-size: var(--font-size-medium, 1rem);
  color: var(--color-base, #202122);
}

.thanks-patrol__pages-label-text {
  font-weight: var(--font-weight-bold, 700);
}

.thanks-patrol__pages-hint {
  margin: var(--spacing-50, 0.5rem) 0 0;
  font-size: var(--font-size-small, 0.875rem);
  color: var(--color-subtle, #54595d);
}

.thanks-patrol__lead {
  margin: 0 0 var(--spacing-100, 1rem);
  font-size: var(--font-size-medium, 1rem);
  color: var(--color-base, #202122);
}

.thanks-patrol__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.thanks-patrol__hr {
  border: none;
  border-top: 1px solid var(--border-color-subtle, #c8ccd1);
  margin: var(--spacing-75, 0.75rem) 0 0;
}

.thanks-patrol__row {
  margin: 0;
}

.thanks-patrol__card-layout {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--spacing-50, 0.5rem);
  padding-block-start: var(--spacing-50, 0.5rem);
  padding-block-end: 0;
}

.thanks-patrol__card-main {
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}

.thanks-patrol__card-main > p {
  margin-block: 0;
}

.thanks-patrol__card-actions {
  flex-shrink: 0;
}

.thanks-patrol__heart-btn.cdx-button {
  overflow: visible;
  min-height: 1.75rem;
  min-width: 1.75rem;
  padding-inline: var(--spacing-35, 6px);
  padding-block: var(--spacing-35, 6px);
}

.thanks-patrol__heart-btn.cdx-button:focus:not(:focus-visible) {
  outline: none !important;
  box-shadow: none !important;
  border-color: var(--border-color-transparent, transparent) !important;
}

.thanks-patrol__heart-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.thanks-patrol__heart-glyph svg {
  display: block;
  overflow: visible;
}

.thanks-patrol__heart-btn--outline .thanks-patrol__heart-glyph {
  color: var(--color-neutral);
}

.thanks-patrol__heart-btn--filled .thanks-patrol__heart-glyph {
  color: var(--color-destructive);
}

.thanks-patrol__row--dimmed {
  opacity: 0.35;
}

.thanks-patrol__article-line {
  margin-block-end: var(--spacing-12, 2px);
  font-size: var(--font-size-medium, 1rem);
}

.thanks-patrol__article-link {
  color: var(--color-base, #202122);
  font-weight: var(--font-weight-bold, 700);
  text-decoration: none;
}

.thanks-patrol__article-link:hover {
  color: var(--color-base, #202122);
  text-decoration: underline;
}

.thanks-patrol__card-header {
  margin-block-end: var(--spacing-12, 2px);
  font-size: var(--font-size-medium, 1rem);
  color: var(--color-subtle, #54595d);
  font-weight: var(--font-weight-normal, 400);
}

.thanks-patrol__card-body {
  margin: 0;
  font-size: var(--font-size-medium, 1rem);
  color: var(--color-base, #202122);
  font-weight: var(--font-weight-normal, 400);
}

.thanks-patrol__card-body--placeholder {
  color: var(--color-subtle, #54595d);
}

.thanks-patrol__summary-html :deep(p) {
  margin: 0;
  display: inline;
}

.thanks-patrol__summary-html :deep(a) {
  color: var(--color-progressive, #36c);
}

.thanks-patrol__summary-html :deep(.thanks-patrol__summary-placeholder) {
  color: inherit;
}

.thanks-patrol__summary-pending {
  color: var(--color-subtle, #54595d);
}

.thanks-patrol__meta-link {
  color: var(--color-progressive, #36c);
  text-decoration: none;
}

.thanks-patrol__meta-link:hover {
  text-decoration: underline;
}

.thanks-patrol__meta-time {
  color: var(--color-subtle, #54595d);
  text-decoration: none;
}

.thanks-patrol__meta-time:hover {
  color: var(--color-base, #202122);
  text-decoration: underline;
}

.thanks-patrol__sep {
  margin-inline: var(--spacing-25, 0.25rem);
}
</style>

<!-- Same teleported confetti overlay as Recently edited paragraph (`protowikiHeartConfetti`). -->
<style>
.protowiki-demo-heart-confetti-layer {
  position: fixed;
  inset: 0;
  z-index: 10050;
  overflow: visible;
  pointer-events: none;
}

.protowiki-demo-heart-confetti-piece {
  position: fixed;
  margin: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

.protowiki-demo-heart-confetti-piece__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.protowiki-demo-heart-confetti-piece__glyph svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: currentColor;
}
</style>
