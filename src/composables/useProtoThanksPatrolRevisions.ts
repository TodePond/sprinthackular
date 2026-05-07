import { FakeWiki, type FWUserInfo } from 'fakewiki'
import type { FWRevision } from 'fakewiki/types'
import { computed, onMounted, ref, watch } from 'vue'

import { stripLinksFromHtml } from '@/lib/stripHtmlLinks'

const API_UA = 'ProtoWiki/0.1 (https://github.com/wikimedia-research/protowiki) prototype'

/** Shared between thanks-dashboard and thanks-module (patrol username + cache). */
export const PROTO_THANKS_FLOW_USERNAME_KEY = 'protowiki-thanks-flow-username'
export const PROTO_THANKS_FLOW_REVISIONS_KEY = 'protowiki-thanks-flow-revisions'

/** @deprecated Use PROTO_THANKS_FLOW_USERNAME_KEY */
export const PROTO_THANKS_FLOW_PAGES_KEY = PROTO_THANKS_FLOW_USERNAME_KEY

const DEFAULT_PATROL_USERNAME = 'Todepond'
/** Scan this many recent mainspace contribs to discover distinct pages to patrol. */
const PATROL_CONTRIB_LOOKBACK = 100
/** Up to this many distinct article titles (newest-first by touch). */
const PATROL_DISTINCT_PAGE_CAP = 12

const REVISION_LIMIT = 80
const MAX_EDIT_COUNT_FOR_LIST = 100
/** “New editor” ribbon when the revision author has this many edits or fewer (inclusive). */
const NEW_EDITOR_MAX_EDITS = 10
/**
 * Merge revisions from all patrol pages, sort newest-first, then consider at least this many
 * candidates before user/edit-count filtering (filter drops editors with &gt;100 edits, so a small
 * slice yields very few rows if recent history is mostly experienced editors).
 */
const PATROL_MERGED_CANDIDATES_CAP = 300
/** Max revisions returned to the feed after filtering. */
const PATROL_OUTPUT_LIMIT = 80
const CACHE_VERSION = 13 as const

export interface ThanksPatrolRevisionRow {
  articleTitle: string
  revid: number
  parentid: number
  user: string
  userid?: number
  timestamp: string
  comment?: string
  parsedcomment?: string
  minor?: boolean
  dimmed?: boolean
  summaryHtml?: string
  summaryPlaceholder?: boolean
  /** Revision author's total edit count (when known); drives thanksPatrolNewEditor 0–NEW_EDITOR_MAX_EDITS. */
  patrolSubjectEditorEditcount?: number | null
}

interface ThanksPatrolCache {
  v: typeof CACHE_VERSION
  title: string
  revisions: ThanksPatrolRevisionRow[]
}

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

interface UserContribRaw {
  title?: string
}

export type ThanksPatrolFwRevision = FWRevision & { thanksPatrolNewEditor?: boolean }

export function useProtoThanksPatrolRevisions(options: {
  usernameStorageKey: string
  revisionsStorageKey: string
}) {
  const wiki = new FakeWiki('https://en.wikipedia.org/', { apiUserAgent: API_UA })

  function loadUsernameFromStorage(): string {
    try {
      const s = localStorage.getItem(options.usernameStorageKey)
      if (s != null && s.trim()) return s.trim()
    } catch {
      /* ignore */
    }
    return DEFAULT_PATROL_USERNAME
  }

  function saveUsernameToStorage(raw: string): void {
    try {
      localStorage.setItem(options.usernameStorageKey, raw.trim() || DEFAULT_PATROL_USERNAME)
    } catch {
      /* ignore */
    }
  }

  const patrolUsernameInput = ref(loadUsernameFromStorage())

  const normalizedPatrolUsername = computed(() => {
    const t = patrolUsernameInput.value.trim()
    return t.length > 0 ? t : DEFAULT_PATROL_USERNAME
  })

  const patrolScopeLabel = computed(() => `patrol:${normalizedPatrolUsername.value}`)

  const revisions = ref<ThanksPatrolRevisionRow[]>([])
  const fwRevisions = ref<ThanksPatrolFwRevision[]>([])
  const pageTitleResolved = ref(patrolScopeLabel.value)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const didAttemptLiveRefresh = ref(false)
  const lastLiveFetchReturnedNothing = ref(false)

  watch(patrolUsernameInput, (v) => saveUsernameToStorage(v))

  function rebuildFwRevisions(): void {
    const patrol = normalizedPatrolUsername.value
    fwRevisions.value = revisions.value
      .filter((r) => !revisionAuthorIsPatroller(r.user, patrol))
      .map((r) => ({
        id: r.revid,
        timestamp: r.timestamp,
        user: { name: r.user || '(unknown)' },
        delta: null,
        comment: r.comment ?? '',
        pageName: r.articleTitle,
        summary: {
          comment: stripLinksFromHtml(
            r.summaryHtml && r.summaryHtml.trim() ? r.summaryHtml : '<span>(no summary)</span>',
          ),
        },
        thanksPatrolNewEditor: isNewEditorByEditcount(r.patrolSubjectEditorEditcount),
      }))
  }

  watch(revisions, () => rebuildFwRevisions(), { deep: true })
  watch(normalizedPatrolUsername, () => rebuildFwRevisions())

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

  function isNewEditorByEditcount(editcount: unknown): boolean {
    if (typeof editcount !== 'number' || Number.isNaN(editcount)) return false
    return editcount >= 0 && editcount <= NEW_EDITOR_MAX_EDITS
  }

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

  function buildSummaryHtmlWithoutTransform(r: ThanksPatrolRevisionRow): {
    html: string
    placeholder: boolean
  } {
    const c = (r.comment ?? '').trim()
    if (!c) {
      if (r.parsedcomment?.trim()) {
        return {
          html: stripLinksFromHtml(r.parsedcomment),
          placeholder: false,
        }
      }
      return {
        html: '<span>(no summary)</span>',
        placeholder: true,
      }
    }
    const plain = parseEditSummary(r.comment)
    return {
      html: `<span>${escapeHtml(plain)}</span>`,
      placeholder: plain === '(no summary)',
    }
  }

  async function buildSummaryHtml(
    r: ThanksPatrolRevisionRow,
    pageTitle: string,
  ): Promise<{ html: string; placeholder: boolean }> {
    const c = (r.comment ?? '').trim()
    if (!c) {
      if (r.parsedcomment?.trim()) {
        return { html: stripLinksFromHtml(r.parsedcomment), placeholder: false }
      }
      return {
        html: '<span>(no summary)</span>',
        placeholder: true,
      }
    }
    try {
      const html = await wiki.getEditSummaryHtml(c, pageTitle)
      return {
        html: stripLinksFromHtml(stripFakewikiSummaryParentheses(html)),
        placeholder: false,
      }
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
      const patch: ThanksPatrolRevisionRow = {
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

  function isTemporaryAccount(u: FWUserInfo): boolean {
    return typeof u.tempexpired === 'boolean'
  }

  function isTemporaryPatrolUsername(username: string): boolean {
    return username.startsWith('~')
  }

  async function wikiActionQuery(params: Record<string, unknown>): Promise<any> {
    return wiki.request({
      api: 'action',
      params: {
        action: 'query',
        ...params,
      },
    })
  }

  function firstQueryPage(data: any):
    | {
        title?: string
        missing?: boolean | string
        revisions?: WikiRevisionRaw[]
      }
    | undefined {
    const pages = data?.query?.pages
    if (pages == null) return undefined
    const list = Array.isArray(pages) ? pages : Object.values(pages as Record<string, unknown>)
    const first = list[0] as {
      title?: string
      missing?: boolean | string
      revisions?: WikiRevisionRaw[]
    }
    return first
  }

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

  function normalizeRevision(
    r: WikiRevisionRaw,
  ): Omit<ThanksPatrolRevisionRow, 'articleTitle'> | null {
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

  /** Match patrol scope user to revision author (spaces/underscores, case-insensitive). */
  function revisionAuthorIsPatroller(revisionUser: string, patrolUsername: string): boolean {
    const a = revisionUser.trim().replace(/ /g, '_').toLowerCase()
    const b = patrolUsername.trim().replace(/ /g, '_').toLowerCase()
    return a.length > 0 && b.length > 0 && a === b
  }

  function mergeRevisionListsDescending(
    chunks: Array<{ raw: WikiRevisionRaw; articleTitle: string }>,
  ): Array<{ raw: WikiRevisionRaw; articleTitle: string }> {
    return [...chunks].sort(
      (a, b) => parseWikiTimestamp(b.raw.timestamp) - parseWikiTimestamp(a.raw.timestamp),
    )
  }

  async function fetchDistinctPatrolTitles(username: string): Promise<string[]> {
    const data = await wikiActionQuery({
      list: 'usercontribs',
      ucuser: username,
      uclimit: PATROL_CONTRIB_LOOKBACK,
      ucnamespace: 0,
      ucprop: 'title|timestamp|ids',
    })

    const err = data?.error
    if (err) {
      const code = err.code ?? 'unknown'
      const info = err.info ?? JSON.stringify(err)
      throw new Error(`${code}: ${info}`)
    }

    const contribs = (data?.query?.usercontribs ?? []) as UserContribRaw[]
    const seen = new Set<string>()
    const titles: string[] = []
    for (const c of contribs) {
      const t = (c.title ?? '').trim()
      if (!t) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      titles.push(t)
      if (titles.length >= PATROL_DISTINCT_PAGE_CAP) break
    }
    return titles
  }

  async function fetchFilteredRevisions(): Promise<{
    title: string
    list: ThanksPatrolRevisionRow[]
  }> {
    const user = normalizedPatrolUsername.value
    const activePageTitles = await fetchDistinctPatrolTitles(user)

    if (activePageTitles.length === 0) {
      return { title: patrolScopeLabel.value, list: [] }
    }

    const mergedChunks: Array<{ raw: WikiRevisionRaw; articleTitle: string }> = []

    for (const articleTitle of activePageTitles) {
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

    const pool = mergeRevisionListsDescending(mergedChunks).slice(0, PATROL_MERGED_CANDIDATES_CAP)

    const namesForLookup = pool.map(({ raw }) => (raw.user ?? '').trim()).filter(Boolean)
    const userMap = await fetchUsersByName(namesForLookup)

    const list: ThanksPatrolRevisionRow[] = []

    for (const { raw, articleTitle } of pool) {
      const base = normalizeRevision(raw)
      if (!base) continue
      if (revisionAuthorIsPatroller(base.user, user)) continue

      const row: ThanksPatrolRevisionRow = { ...base, articleTitle }

      if (revisionIsIpAnon(raw)) {
        const ip = (raw.user ?? '').trim()
        if (!ip) continue
        const uIp = userMap.get(ip)
        if (uIp && exceedsPatrolEditLimit(uIp.editcount)) continue
        row.dimmed = revisionMarkedBot(raw)
        row.patrolSubjectEditorEditcount =
          uIp && typeof uIp.editcount === 'number' && !Number.isNaN(uIp.editcount)
            ? uIp.editcount
            : null
        list.push(row)
        continue
      }

      const revUser = (raw.user ?? '').trim()
      if (!revUser) continue
      if (isTemporaryPatrolUsername(revUser)) continue

      const u = userMap.get(revUser)
      if (!u || u.missing || u.invalid) continue
      if (exceedsPatrolEditLimit(u.editcount)) continue
      if (isTemporaryAccount(u)) continue

      row.dimmed = revisionMarkedBot(raw) || isBotAccount(u)
      row.patrolSubjectEditorEditcount =
        typeof u.editcount === 'number' && !Number.isNaN(u.editcount) ? u.editcount : null
      list.push(row)
    }

    return { title: patrolScopeLabel.value, list: list.slice(0, PATROL_OUTPUT_LIMIT) }
  }

  function loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(options.revisionsStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as ThanksPatrolCache
      if (parsed.v !== CACHE_VERSION || !Array.isArray(parsed.revisions)) return
      const expectedScope = patrolScopeLabel.value
      const cachedTitle =
        typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : ''
      if (cachedTitle !== expectedScope) return
      pageTitleResolved.value = cachedTitle
      revisions.value = parsed.revisions
    } catch {
      /* ignore */
    }
  }

  function saveToStorage(title: string, list: ThanksPatrolRevisionRow[]): void {
    try {
      const payload: ThanksPatrolCache = {
        v: CACHE_VERSION,
        title,
        revisions: list,
      }
      localStorage.setItem(options.revisionsStorageKey, JSON.stringify(payload))
    } catch {
      /* ignore */
    }
  }

  async function refresh(): Promise<void> {
    error.value = null
    loading.value = true
    lastLiveFetchReturnedNothing.value = false
    try {
      const { title, list } = await fetchFilteredRevisions()
      pageTitleResolved.value = title
      revisions.value = list
      lastLiveFetchReturnedNothing.value = list.length === 0
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
        /* ignore */
      }
    }
  })

  return {
    wiki,
    patrolUsernameInput,
    /** @deprecated Use patrolUsernameInput */
    pagesInputText: patrolUsernameInput,
    /** Trimmed patrol username (falls back to default when empty). */
    normalizedPatrolUsername,
    patrolScopeLabel,
    revisions,
    fwRevisions,
    loading,
    error,
    refresh,
    didAttemptLiveRefresh,
    lastLiveFetchReturnedNothing,
  }
}
