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
  source: 'recentChanges' as const,
}
