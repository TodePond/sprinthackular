import type { FWRevision } from 'fakewiki/types'

export type ThanksPatrolRevisionCluster = {
  key: string
  revisions: FWRevision[]
}

function clusterKey(r: FWRevision): string {
  const user = (r.user?.name ?? '').trim()
  const page = (r.pageName ?? r.title ?? '').trim()
  return `${user}\0${page}`
}

/**
 * Buckets revisions by (editor, page). Input must already be newest-first overall.
 * Output order: first-seen bucket order (newest activity first).
 * Each bucket’s revisions stay newest-first — multiple edits on the same page cluster into **one card**.
 *
 * Article-quality assessment for that cluster should compare **before** (revision parent of the
 * chronologically oldest edit in the bucket) vs **after** (newest revision id in the bucket).
 */
export function groupThanksPatrolRevisionsByUserAndPage(
  revisions: FWRevision[],
): ThanksPatrolRevisionCluster[] {
  const order: string[] = []
  const buckets = new Map<string, FWRevision[]>()

  for (const r of revisions) {
    const key = clusterKey(r)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    const list = buckets.get(key)!
    if (!list.some((x) => x.id === r.id)) {
      list.push(r)
    }
  }

  return order.map((key) => {
    const revisionsList = [...(buckets.get(key) ?? [])].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    return {
      key,
      revisions: revisionsList,
    }
  })
}

/** Cluster rows are newest-first: index `0` is the latest edit, last index is chronologically oldest. */
export function thanksPatrolClusterNewestRevision(
  cluster: ThanksPatrolRevisionCluster,
): FWRevision | undefined {
  return cluster.revisions[0]
}

export function thanksPatrolClusterOldestRevision(
  cluster: ThanksPatrolRevisionCluster,
): FWRevision | undefined {
  const list = cluster.revisions
  return list.length ? list[list.length - 1] : undefined
}

/**
 * Revision id **before** this patrol cluster’s edits for article-quality “before” score:
 * parent of the chronologically oldest revision in the cluster (requires `thanksPatrolParentRevId`).
 */
export function thanksPatrolArticleQualityBeforeRevId(cluster: ThanksPatrolRevisionCluster): number {
  const oldest = thanksPatrolClusterOldestRevision(cluster)
  const p = oldest && (oldest as FWRevision & { thanksPatrolParentRevId?: number }).thanksPatrolParentRevId
  return typeof p === 'number' && !Number.isNaN(p) ? p : 0
}

/** Revision id **after** the cluster: the newest edit in the cluster (language-agnostic articlequality score). */
export function thanksPatrolArticleQualityAfterRevId(cluster: ThanksPatrolRevisionCluster): number {
  return thanksPatrolClusterNewestRevision(cluster)?.id ?? 0
}
