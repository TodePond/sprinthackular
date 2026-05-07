import { reviewChangesPlusFeedProps } from '@/imports/fakemediawiki-review-changes-plus/reviewChangesPlusFeedProps'

/**
 * Thanks module/dashboard: match Review Changes Plus chrome, but disable pools that
 * would trigger extra Lift Wing / edit-check fetches for externally supplied revisions.
 */
export const thanksModuleFeedProps = {
  ...reviewChangesPlusFeedProps,
  title: 'Thanks patrol',
  requireRecentChangesMeetRevertRiskThresholds: false,
  showRevertRiskFlags: false,
  showRecommendationFlags: false,
  showEditCheckOtherFlag: false,
  showToneCheckFlag: false,
  showStructuredDeltasForFlaggedUnviewed: false,
  /** Patrol list is built from the user’s own contribs — no Wikidata short descriptions beside titles. */
  showShortDescription: false,
  showShortDescriptionSeparator: false,
  /** Figma “After” card: **User** edited **Page**, sprout badge, no footer / user icon / timestamp. */
  protowikiThanksPatrolCompactCard: true,
  /** Merge consecutive-cap list items that share editor + page into one card with stacked summaries. */
  protowikiThanksPatrolGroupSamePageEdits: true,
  /** Card chrome is not a giant link; only each diff row (delta + summary) opens the revision diff. */
  protowikiThanksPatrolDiffOnlyClick: true,
  /** Four blue badge variants in Figma (article quality, good faith, reference, low risk) await patrol signals; not in this feed yet. */
  source: 'recentChanges' as const,
}
