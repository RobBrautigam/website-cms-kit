/**
 * Staging rules for the admin screens: which buttons a staged change offers,
 * whether a pick of changes can be published, which fields a staged copy may
 * carry, and where the draft-mode preview may send the browser.
 *
 * The database enforces the same rules (migration 001's trigger and
 * publish_staged_posts()); these exist so the screens never offer a button
 * the database will refuse. No imports, so the node tests read it directly.
 * Model: docs/10-staging-and-approval.md.
 */

export type ReviewStatus = 'staged' | 'in_review' | 'approved'

export interface StagedSummary {
  id: string
  reviewStatus: ReviewStatus
  stagedBy: string | null
  title: string
}

export interface StagingOptions {
  /** Mirrors public.staging_review_required() in migration 001. */
  reviewRequired?: boolean
}

export interface StagingActions {
  publish: boolean
  requestReview: boolean
  approve: boolean
  withdraw: boolean
  discard: boolean
}

/**
 * Must match public.staging_review_required() in migration 001. Turning on
 * mandatory review means changing both, and hiding "Publish now". With the
 * database switch on, migration 002's two-person lock makes it real: a live
 * post then changes only through an approved staged change.
 */
export const REVIEW_REQUIRED = false

export function canPublish(status: ReviewStatus, opts: StagingOptions = {}): boolean {
  const required = opts.reviewRequired ?? REVIEW_REQUIRED
  if (status === 'approved') return true
  return status === 'staged' && !required
}

export function availableActions(
  stage: Pick<StagedSummary, 'reviewStatus' | 'stagedBy'>,
  viewerId: string | null,
  opts: StagingOptions = {},
): StagingActions {
  const status = stage.reviewStatus
  return {
    publish: canPublish(status, opts),
    requestReview: status === 'staged',
    approve: status === 'in_review' && viewerId !== null && viewerId !== stage.stagedBy,
    withdraw: status === 'in_review' || status === 'approved',
    discard: true,
  }
}

export type SelectionCheck = { ok: true } | { ok: false; message: string }

export function checkPublishSelection(picks: StagedSummary[], opts: StagingOptions = {}): SelectionCheck {
  if (picks.length === 0) {
    return { ok: false, message: 'Pick at least one staged change to publish.' }
  }
  const blocked = picks.find((p) => !canPublish(p.reviewStatus, opts))
  if (blocked) {
    return { ok: false, message: `"${blocked.title}" needs an approval before it can be published. Nothing was published.` }
  }
  return { ok: true }
}

/** The editable content of a post: the only fields a staged copy holds. */
export const STAGED_CONTENT_FIELDS = [
  'title',
  'slug',
  'excerpt',
  'featured_image_url',
  'featured_image_alt',
  'body',
  'categories',
  'meta_description',
  'author_slug',
] as const

export interface StagedContent {
  title: string
  slug: string
  excerpt: string | null
  featured_image_url: string | null
  featured_image_alt: string | null
  body: Record<string, unknown>
  categories: string[]
  meta_description: string | null
  author_slug: string | null
}

const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Copies only the content fields out of a form payload. Review columns,
 * post_id and status are never taken from the client; the database's trigger
 * would ignore them anyway.
 */
export function pickStagedContent(input: Record<string, unknown>): StagedContent {
  const body = input.body
  return {
    title: typeof input.title === 'string' ? input.title : '',
    slug: typeof input.slug === 'string' ? input.slug : '',
    excerpt: textOrNull(input.excerpt),
    featured_image_url: textOrNull(input.featured_image_url),
    featured_image_alt: textOrNull(input.featured_image_alt),
    body: body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {},
    categories: Array.isArray(input.categories) ? input.categories.filter((c): c is string => typeof c === 'string') : [],
    meta_description: textOrNull(input.meta_description),
    author_slug: textOrNull(input.author_slug),
  }
}

const MAX_PREVIEW_PATH = 512

/**
 * The preview route redirects to this path after turning on draft mode, so it
 * must stay on this site: one leading slash, never `//` or `/\` (both are
 * read as another host), no backslashes or control characters anywhere.
 * Same idea as lib/safe-href.ts, narrowed to on-site paths. An empty or
 * missing path means the home page; anything unsafe returns null.
 */
export function safePreviewPath(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '/'
  if (typeof raw !== 'string') return null
  if (raw.length > MAX_PREVIEW_PATH) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}

/**
 * "Publish now" saves the editor's content over the staged copy and
 * publishes it. On a change waiting for review that would cancel the
 * request without a trace, so it is refused; withdraw it first.
 */
export function publishNowRefusal(existing: ReviewStatus | null): string | null {
  if (existing === 'in_review') {
    return "This change is waiting for a teammate's review. Withdraw the request on the Staging page first, or ask them to approve it."
  }
  return null
}

const LABELS: Record<ReviewStatus, string> = {
  staged: 'Staged',
  in_review: 'In review',
  approved: 'Approved',
}

export function reviewLabel(status: ReviewStatus): string {
  return LABELS[status]
}
