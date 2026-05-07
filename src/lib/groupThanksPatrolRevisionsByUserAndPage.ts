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
 * Buckets revisions by (editor, page). Input must already be newest-first.
 * Output order: first-seen bucket order (newest activity first).
 * Each bucket's revisions stay newest-first.
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

  return order.map((key) => ({
    key,
    revisions: buckets.get(key)!,
  }))
}
