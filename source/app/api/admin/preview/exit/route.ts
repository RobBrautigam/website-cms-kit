import { NextResponse, type NextRequest } from 'next/server'
import { draftMode } from 'next/headers'
import { isSameOriginPost, publicOrigin } from '@/lib/staging/rules'

/**
 * POST /api/admin/preview/exit
 *
 * Turns draft mode off and returns to the staging page. POST from a form on
 * this site only: a GET link could be prefetched and clear the preview by
 * accident (Next.js draft mode guide). No admin check is needed to turn the
 * preview off.
 */
export async function POST(request: NextRequest) {
  const h = request.headers
  const site = publicOrigin(h.get('x-forwarded-host'), h.get('x-forwarded-proto'), h.get('host'), request.url)
  if (!isSameOriginPost(h.get('origin'), h.get('sec-fetch-site'), site)) {
    return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 })
  }
  ;(await draftMode()).disable()
  return new NextResponse(null, { status: 303, headers: { Location: '/admin/staging' } })
}
