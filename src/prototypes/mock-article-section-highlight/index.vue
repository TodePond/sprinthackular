<script setup lang="ts">
import { CdxButton, CdxIcon, CdxMenuButton } from '@wikimedia/codex'
import {
  cdxIconEdit,
  cdxIconEllipsis,
  cdxIconEye,
  cdxIconHeart,
  cdxIconHistory,
} from '@wikimedia/codex-icons'
import { createApp, defineComponent, h, nextTick, onMounted, onUnmounted, ref } from 'vue'

import Article from '@/components/Article.vue'
import ChromeWrapper from '@/components/ChromeWrapper.vue'

definePage({
  meta: {
    title: 'Mock article: paragraph highlight + attribution',
    description:
      'Wet Leg mock article with one highlighted paragraph and a small attribution line below it.',
  },
})

const ATTRIBUTION_CLASS = 'protowiki-demo-para-attribution'

const highlightParaSelector =
  '.mw-parser-output section[data-mw-section-id="1"] section[data-mw-section-id="2"] > p:nth-of-type(1)'

const articleContainerRef = ref<HTMLElement | null>(null)
let observer: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

const TODEPOND_USER_HREF = 'https://en.wikipedia.org/wiki/User:Todepond'

/** Sub-app hosts for attribution toolbar (detached DOM cleaned in onMutation). */
const attributionToolbarApps = new Map<HTMLElement, ReturnType<typeof createApp>>()

const overflowMenuItems = [
  { value: 'thanks', label: 'Give thanks', icon: cdxIconHeart },
  { value: 'review', label: 'Review', icon: cdxIconEye },
  { value: 'edit-further', label: 'Edit further', icon: cdxIconEdit },
]

/** Resolves Codex `--color-progressive` (link blue) for teleported confetti (probe avoids wrong inherited color). */
function resolveProgressiveConfettiFill(doc: Document, mountParent: HTMLElement): string {
  const probe = doc.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;color:var(--color-progressive, #3366cc)'
  mountParent.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || 'rgb(51, 102, 204)'
}

function vnodeComponentRoot(el: unknown): HTMLElement | null {
  if (!el) return null
  if (el instanceof HTMLElement) return el
  if (typeof el === 'object' && el !== null && '$el' in el) {
    const root = (el as { $el: unknown }).$el
    return root instanceof HTMLElement ? root : null
  }
  return null
}

function heartConfettiReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Burst of small hearts from the button centre (fixed overlay; prototype-only). */
function spawnHeartConfettiFromButton(buttonEl: HTMLElement) {
  if (typeof document === 'undefined') return
  if (heartConfettiReducedMotion()) return

  const rect = buttonEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  const layer = document.createElement('div')
  layer.className = 'protowiki-demo-heart-confetti-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)

  const confettiFill = resolveProgressiveConfettiFill(buttonEl.ownerDocument, layer)

  const count = 10
  let finished = 0
  /** Longest particle run + buffer (slow, floaty arcs). */
  const maxDuration = 11200

  let fallbackRemove: ReturnType<typeof setTimeout> | undefined
  let layerFinished = false
  const finishLayer = () => {
    if (layerFinished) return
    layerFinished = true
    if (fallbackRemove !== undefined) {
      window.clearTimeout(fallbackRemove)
    }
    layer.remove()
  }

  fallbackRemove = window.setTimeout(() => {
    finishLayer()
  }, maxDuration)

  const doneOne = () => {
    finished += 1
    if (finished >= count) finishLayer()
  }

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const spread = 72 + Math.random() * 118
    const dx = Math.cos(angle) * spread
    /** Strong upward pop; screen Y grows downward, so negative = higher. */
    const lift = 140 + Math.random() * 160
    const rot = (Math.random() - 0.5) * 72
    const size = 14 + Math.random() * 12

    const piece = document.createElement('span')
    piece.className = 'protowiki-demo-heart-confetti-piece'
    piece.style.left = `${cx}px`
    piece.style.top = `${cy}px`
    piece.style.width = `${size}px`
    piece.style.height = `${size}px`
    piece.style.color = confettiFill
    /* No `cdx-icon` wrapper — Codex forces `.cdx-icon { color: var(--color-base) }`; we want progressive blue. */
    piece.innerHTML = `<span class="protowiki-demo-heart-confetti-piece__glyph" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="currentColor">${cdxIconHeart}</svg></span>`

    layer.appendChild(piece)

    const duration = 6000 + Math.random() * 4500

    /** One continuous move; opacity fades in parallel from the first frame (no end-weighted delay). */
    const xEnd = dx * 1.02
    const yEnd = -lift

    try {
      const move = piece.animate(
        [
          {
            transform: 'translate(-50%, -50%) translate(0px, 0px) rotate(0deg) scale(1)',
          },
          {
            transform: `translate(-50%, -50%) translate(${xEnd}px, ${yEnd}px) rotate(${rot}deg) scale(0.36)`,
          },
        ],
        {
          duration,
          easing: 'cubic-bezier(0.07, 0.88, 0.2, 1)',
          fill: 'forwards',
        },
      )
      const fade = piece.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration,
        delay: 0,
        easing: 'linear',
        fill: 'forwards',
      })
      move.onfinish = () => {
        fade.cancel()
        piece.remove()
        doneOne()
      }
    } catch {
      piece.remove()
      doneOne()
    }
  }
}

function removeHeartConfettiLayers() {
  if (typeof document === 'undefined') return
  document.querySelectorAll('.protowiki-demo-heart-confetti-layer').forEach((el) => el.remove())
}

const AttributionToolbar = defineComponent({
  name: 'AttributionToolbar',
  setup() {
    const menuSelected = ref<string | null>(null)
    const thanksActive = ref(false)
    const heartButtonRoot = ref<HTMLElement | null>(null)
    return () =>
      h('span', { class: 'protowiki-demo-para-attribution__toolbar' }, [
        h(
          CdxButton,
          {
            ref: (el: unknown) => {
              heartButtonRoot.value = vnodeComponentRoot(el)
            },
            weight: 'quiet',
            size: 'small',
            class: [
              'protowiki-demo-para-attribution__heart-btn',
              thanksActive.value
                ? 'protowiki-demo-para-attribution__heart-btn--filled'
                : 'protowiki-demo-para-attribution__heart-btn--outline',
            ],
            'aria-pressed': thanksActive.value ? 'true' : 'false',
            'aria-label': thanksActive.value ? 'Remove thanks' : 'Give thanks',
            onClick: () => {
              const wasActive = thanksActive.value
              thanksActive.value = !thanksActive.value
              if (thanksActive.value && !wasActive) {
                void nextTick(() => {
                  const btn = heartButtonRoot.value
                  if (btn) spawnHeartConfettiFromButton(btn)
                })
              }
            },
          },
          {
            default: () => h(CdxIcon, { icon: cdxIconHeart, size: 'small' }),
          },
        ),
        h(
          CdxMenuButton,
          {
            weight: 'quiet',
            class: 'protowiki-demo-para-attribution__overflow-btn',
            selected: menuSelected.value,
            'onUpdate:selected': (v: string | null) => {
              menuSelected.value = v
            },
            menuItems: overflowMenuItems,
            'aria-label': 'More options',
          },
          {
            default: () => h(CdxIcon, { icon: cdxIconEllipsis, size: 'small' }),
          },
        ),
      ])
  },
})

function cleanupDetachedAttributionToolbars() {
  for (const [mountEl, app] of attributionToolbarApps) {
    if (!mountEl.isConnected) {
      app.unmount()
      attributionToolbarApps.delete(mountEl)
    }
  }
}

function unmountAllAttributionToolbars() {
  for (const [, app] of attributionToolbarApps) {
    app.unmount()
  }
  attributionToolbarApps.clear()
}

function mountAttributionToolbar(mountEl: HTMLElement) {
  if (attributionToolbarApps.has(mountEl)) return

  const app = createApp(AttributionToolbar)
  app.mount(mountEl)
  attributionToolbarApps.set(mountEl, app)
}

/**
 * Outline is drawn outside the paragraph border box + outline-offset. Match the
 * tinted bar edges to that visual rectangle (percentage widths drift vs wiki layout).
 */
function syncAttributionLayout() {
  const root = articleContainerRef.value
  if (!root) return

  const p = root.querySelector<HTMLElement>(highlightParaSelector)
  const attn = p?.nextElementSibling
  if (
    !p?.parentElement ||
    !(attn instanceof HTMLElement) ||
    !attn.classList.contains(ATTRIBUTION_CLASS)
  ) {
    return
  }

  const parent = p.parentElement as HTMLElement
  const pRect = p.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  const vw = root.ownerDocument.defaultView
  const pst = vw?.getComputedStyle(p)
  let outlineOffsetPx = pst ? Number.parseFloat(pst.outlineOffset) : NaN
  let outlineWidthPx = pst ? Number.parseFloat(pst.outlineWidth) : NaN
  if (Number.isNaN(outlineOffsetPx)) outlineOffsetPx = 6
  if (Number.isNaN(outlineWidthPx)) outlineWidthPx = 2

  const inflate = outlineOffsetPx + outlineWidthPx
  const widthPx = pRect.width + 2 * inflate

  const parentDir = vw?.getComputedStyle(parent).direction === 'rtl' ? 'rtl' : 'ltr'
  const insetStart =
    parentDir === 'rtl'
      ? parentRect.right - pRect.right - inflate
      : pRect.left - parentRect.left - inflate

  attn.style.boxSizing = 'border-box'
  attn.style.width = `${Math.round(widthPx * 1000) / 1000}px`
  attn.style.marginInlineStart = `${Math.round(insetStart * 1000) / 1000}px`
  attn.style.marginInlineEnd = '0'
}

function scheduleSyncAttributionLayout() {
  requestAnimationFrame(() => {
    syncAttributionLayout()
    requestAnimationFrame(() => syncAttributionLayout())
  })
}

function insertAttribution() {
  const root = articleContainerRef.value
  if (!root) return

  const p = root.querySelector<HTMLElement>(highlightParaSelector)
  if (!p?.parentElement) return

  const next = p.nextElementSibling
  if (next?.classList.contains(ATTRIBUTION_CLASS)) return

  const line = document.createElement('div')
  line.className = ATTRIBUTION_CLASS

  const row = document.createElement('span')
  row.className = 'protowiki-demo-para-attribution__row'

  const iconWrap = document.createElement('span')
  iconWrap.className = 'protowiki-demo-para-attribution__icon'
  iconWrap.setAttribute('aria-hidden', 'true')
  iconWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">${cdxIconHistory}</svg>`

  const text = document.createElement('span')
  text.className = 'protowiki-demo-para-attribution__text'
  text.append(document.createTextNode('Edited yesterday by '))

  const userLink = document.createElement('a')
  userLink.className = 'protowiki-demo-para-attribution__user'
  userLink.href = TODEPOND_USER_HREF
  userLink.rel = 'noopener noreferrer'
  userLink.target = '_blank'
  userLink.textContent = 'Todepond'

  text.appendChild(userLink)

  const actionsMount = document.createElement('span')
  actionsMount.className = 'protowiki-demo-para-attribution__actions'

  row.appendChild(iconWrap)
  row.appendChild(text)
  row.appendChild(actionsMount)
  line.appendChild(row)

  p.insertAdjacentElement('afterend', line)

  mountAttributionToolbar(actionsMount)
  scheduleSyncAttributionLayout()
}

function onMutation() {
  cleanupDetachedAttributionToolbars()
  insertAttribution()
  scheduleSyncAttributionLayout()
}

onMounted(() => {
  void nextTick(() => {
    insertAttribution()

    const el = articleContainerRef.value
    if (!el) return

    observer = new MutationObserver(() => {
      onMutation()
    })
    observer.observe(el, { childList: true, subtree: true })

    resizeObserver = new ResizeObserver(() => {
      scheduleSyncAttributionLayout()
    })
    resizeObserver.observe(el)

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', scheduleSyncAttributionLayout)
      window.visualViewport?.addEventListener('resize', scheduleSyncAttributionLayout)
    }

    scheduleSyncAttributionLayout()
  })
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null

  resizeObserver?.disconnect()
  resizeObserver = null

  removeHeartConfettiLayers()
  unmountAllAttributionToolbars()

  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', scheduleSyncAttributionLayout)
    window.visualViewport?.removeEventListener('resize', scheduleSyncAttributionLayout)
  }
})
</script>

<template>
  <ChromeWrapper>
    <div ref="articleContainerRef" class="article-container">
      <Article content-type="mock" />
    </div>
  </ChromeWrapper>
</template>

<style scoped>
.article-container {
  padding: 0 var(--spacing-100);
}

.article-container :deep(.protowiki-demo-para-attribution) {
  display: block;
  clear: both;
  margin-block: var(--spacing-35, 6px) var(--spacing-100, 16px);
  margin-inline-end: 0;
  padding-block: var(--spacing-35, 6px);
  padding-inline: var(--spacing-50, 8px);
  background-color: color-mix(in srgb, var(--color-progressive) 8%, var(--background-color-base));
  font-size: var(--font-size-x-small);
  line-height: var(--line-height-small, 1.4);
  color: var(--color-subtle);
}

.article-container :deep(.protowiki-demo-para-attribution__row) {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--spacing-35, 6px);
  width: 100%;
  box-sizing: border-box;
}

.article-container :deep(.protowiki-demo-para-attribution__icon) {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-base);
}

.article-container :deep(.protowiki-demo-para-attribution__icon svg) {
  display: block;
}

.article-container :deep(.protowiki-demo-para-attribution__text) {
  flex: 1;
  min-width: 0;
}

.article-container :deep(.protowiki-demo-para-attribution__actions) {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
}

.article-container :deep(.protowiki-demo-para-attribution__toolbar) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

/* Icon-only quiet controls — slightly larger than the previous x-small strip. */
.article-container :deep(.protowiki-demo-para-attribution__heart-btn.cdx-button) {
  /* Codex buttons use overflow:hidden (ellipsis); outline stroke extends past the glyph bbox. */
  overflow: visible;
  min-height: 1.75rem;
  min-width: 1.75rem;
  padding-inline: var(--spacing-35, 6px);
  padding-block: var(--spacing-35, 6px);
}

/* Pointer/tap focus shows no ring; keyboard :focus-visible keeps Codex focus affordance. */
.article-container
  :deep(.protowiki-demo-para-attribution__heart-btn.cdx-button:focus:not(:focus-visible)) {
  outline: none !important;
  box-shadow: none !important;
  border-color: var(--border-color-transparent, transparent) !important;
}

.article-container :deep(.protowiki-demo-para-attribution__heart-btn .cdx-icon),
.article-container :deep(.protowiki-demo-para-attribution__heart-btn .cdx-icon svg) {
  overflow: visible;
}

/* Outline heart + overflow: neutral grey (quiet toolbar). Filled thanks heart: progressive blue (matches confetti). */
.article-container :deep(.protowiki-demo-para-attribution__heart-btn--outline .cdx-icon),
.article-container :deep(.protowiki-demo-para-attribution__overflow-btn .cdx-icon) {
  color: var(--color-neutral);
}

.article-container :deep(.protowiki-demo-para-attribution__heart-btn--filled .cdx-icon) {
  color: var(--color-progressive);
}

/* Codex only ships a filled heart path; draw it as outline until toggled on. */
.article-container :deep(.protowiki-demo-para-attribution__heart-btn--outline .cdx-icon svg path) {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.15;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.article-container :deep(.protowiki-demo-para-attribution__heart-btn--filled .cdx-icon svg path) {
  stroke: none;
}

.article-container :deep(.protowiki-demo-para-attribution__overflow-btn .cdx-button) {
  min-height: 1.75rem;
  min-width: 1.75rem;
  padding-inline: var(--spacing-35, 6px);
  padding-block: var(--spacing-35, 6px);
}

/* Global `ul, ol` adds padding-inline-start; Codex menu listbox is a `ul` and inherits it. */
.article-container :deep(.cdx-menu__listbox) {
  margin-inline-start: 0;
  padding-inline-start: 0;
}

/*
 * CdxMenuButton uses useFloatingMenu({ useAvailableWidth: true, offset: 4 }), which sets a
 * very wide inline width and a 4px gap below the trigger. Tighten for this attribution strip.
 */
.article-container :deep(.protowiki-demo-para-attribution__overflow-btn .cdx-menu-button__menu) {
  min-width: 0 !important;
  max-width: none !important;
}

.article-container :deep(.protowiki-demo-para-attribution__overflow-btn .cdx-menu) {
  width: max-content !important;
  min-width: 0 !important;
  max-width: none !important;
  margin-top: -4px !important;
}

.article-container
  :deep(.protowiki-demo-para-attribution__overflow-btn .cdx-menu-item .cdx-menu-item__content) {
  flex-wrap: nowrap;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}

.article-container :deep(.protowiki-demo-para-attribution__user),
.article-container :deep(.protowiki-demo-para-attribution__user:visited) {
  color: var(--color-progressive);
  text-decoration: none;
}

.article-container :deep(.protowiki-demo-para-attribution__user:hover) {
  opacity: 0.85;
}

/* First body paragraph under History / "Early lives" — avoids outlining the whole H2 section. */
.article-container
  :deep(
    .mw-parser-output
      section[data-mw-section-id='1']
      section[data-mw-section-id='2']
      > p:nth-of-type(1)
  ) {
  /* background-color: color-mix(in srgb, var(--color-progressive) 8%, var(--background-color-base)); */
  outline: 1px solid var(--border-color-progressive);
  outline-offset: var(--spacing-35, 6px);
}
</style>

<!-- Teleported confetti layer is appended to document.body; keep unscoped. -->
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
