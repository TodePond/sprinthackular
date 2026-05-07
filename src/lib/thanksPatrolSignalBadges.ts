import type { FWEditTypesDiffSummary, FWLiftWingPrediction } from 'fakewiki/types'

/** Exclude patrol rows when revert probability exceeds this (aligned with elevated revert-risk notices). */
export const THANKS_PATROL_EXCLUDE_REVERT_RISK_ABOVE = 0.9

/** Exclude when good-faith P(true) is strictly below this. */
export const THANKS_PATROL_EXCLUDE_GOODFAITH_BELOW = 0.5

/** “Good faith” pill when P(true) is above this. */
export const THANKS_PATROL_GOODFAITH_BADGE_MIN = 0.9

/** “Low risk” pill when revert P(true) is below this (matches REVERT_RISK blue band). */
export const THANKS_PATROL_LOW_REVERT_RISK_BELOW = 0.45

export const THANKS_PATROL_ARTICLE_QUALITY_EPSILON = 1e-6

export type ThanksPatrolSignalKind =
  | 'reference'
  | 'articleQuality'
  | 'lowRisk'
  | 'goodFaith'

export interface ThanksPatrolResolvedSignalBadge {
  kind: ThanksPatrolSignalKind
  label: string
}

export function editTypesSummaryHasReferenceInsert(
  summary: FWEditTypesDiffSummary | null | undefined,
): boolean {
  if (!summary) return false
  for (const [typeName, counts] of Object.entries(summary)) {
    if (!/reference|citation/i.test(typeName)) continue
    const ins = counts?.insert
    if (typeof ins === 'number' && ins >= 1) return true
  }
  return false
}

export function revertProbabilityTrue(pred: FWLiftWingPrediction | undefined): number | null {
  const p = pred?.probability?.true
  return typeof p === 'number' ? p : null
}

export function goodfaithProbabilityTrue(pred: FWLiftWingPrediction | undefined): number | null {
  return revertProbabilityTrue(pred)
}

export async function fetchLanguageAgnosticArticleQualityScore(
  revId: number,
  lang: string,
  apiUserAgent: string,
): Promise<number | null> {
  const url = 'https://api.wikimedia.org/service/lw/inference/v1/models/articlequality:predict'
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-User-Agent': apiUserAgent,
      },
      body: JSON.stringify({ rev_id: revId, lang }),
    })
    if (!response.ok) return null
    const data = (await response.json()) as { score?: number }
    return typeof data.score === 'number' && !Number.isNaN(data.score) ? data.score : null
  } catch {
    return null
  }
}
