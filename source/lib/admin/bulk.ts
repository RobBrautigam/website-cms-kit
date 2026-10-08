/**
 * Bulk actions on the posts list: publish, unpublish or delete several posts
 * at once. The plan says which posts the action applies to and why each of
 * the others is skipped, so one bad row never blocks the rest and nothing is
 * skipped silently. The server action re-reads the posts and plans again;
 * the browser's copy is never trusted.
 */

export const BULK_ACTIONS = ['publish', 'unpublish', 'delete'] as const
export type BulkAction = (typeof BULK_ACTIONS)[number]

export type BulkPost = {
  id: string
  title: string
  status: 'draft' | 'published' | 'scheduled'
  /** Images without alt text (featured plus body); see lib/admin/alt-text.ts. */
  missingAlt: number
  /** The post has a staged copy waiting on the Staging page. */
  hasStagedCopy: boolean
}

export type BulkPlan = { apply: string[]; skipped: { id: string; title: string; reason: string }[] }

export const MAX_BULK = 100

export function isBulkAction(value: unknown): value is BulkAction {
  return typeof value === 'string' && (BULK_ACTIONS as readonly string[]).includes(value)
}

export function planBulk(action: BulkAction, posts: BulkPost[], opts: { reviewRequired: boolean }): BulkPlan {
  const plan: BulkPlan = { apply: [], skipped: [] }
  for (const p of posts.slice(0, MAX_BULK)) {
    const skip = (reason: string) => plan.skipped.push({ id: p.id, title: p.title, reason })
    if (action === 'publish') {
      if (opts.reviewRequired) skip('Review is required: publish it from the Staging page.')
      else if (p.status === 'published') skip('Already live.')
      else if (p.missingAlt > 0) skip('Images without alt text.')
      else plan.apply.push(p.id)
    } else if (action === 'unpublish') {
      if (p.status !== 'published') skip('Not live.')
      else plan.apply.push(p.id)
    } else {
      if (p.hasStagedCopy) skip('Has a staged change: discard it on the Staging page first.')
      else plan.apply.push(p.id)
    }
  }
  for (const p of posts.slice(MAX_BULK)) plan.skipped.push({ id: p.id, title: p.title, reason: `Over the ${MAX_BULK}-post limit for one action.` })
  return plan
}

export function bulkSummary(action: BulkAction, plan: BulkPlan): string {
  const verb = { publish: 'Published', unpublish: 'Unpublished', delete: 'Deleted' }[action]
  const n = plan.apply.length
  const head = `${verb} ${n} post${n === 1 ? '' : 's'}.`
  if (plan.skipped.length === 0) return head
  return `${head} Skipped ${plan.skipped.length}: ${plan.skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}`
}
