import { NextResponse, type NextRequest } from 'next/server'
import { draftMode } from 'next/headers'
import { requireAdmin } from '@/lib/auth/require'
import { recordAdminAction } from '@/lib/auth/audit'
import { safePreviewPath } from '@/lib/staging/rules'
import { crossSiteRefusal } from '@/lib/security/request-origin'

/**
 * POST /api/admin/preview  (form field `path`, default `/`)
 *
 * Turns on Next.js draft mode for this browser and sends it to `path` on
 * this site, where pages that call getPreviewPost()/getPreviewPosts() show
 * staged content. Admin-only (requireAdmin: active admin, two-factor), a
 * form posted from this site only, on-site paths only.
 *
 * Draft mode is a cache switch, not a login; the preview reads re-check the
 * admin session on every request. See docs/10-staging-and-approval.md.
 */
export async function POST(request: NextRequest) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  await requireAdmin()

  const form = await request.formData().catch(() => null)
  const path = safePreviewPath(form?.get('path') ?? undefined)
  if (!path) {
    return NextResponse.json({ error: 'Preview path must be a path on this site.' }, { status: 400 })
  }

  ;(await draftMode()).enable()
  await recordAdminAction({
    action: 'staging.preview_enabled',
    resource_type: 'staging',
    payload: { path },
  })
  // 303 so the browser follows with a GET. A relative Location stays on the
  // host the browser used (request.url can be the server's bind address).
  return new NextResponse(null, { status: 303, headers: { Location: path } })
}
