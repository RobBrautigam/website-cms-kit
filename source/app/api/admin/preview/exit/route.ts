import { NextResponse, type NextRequest } from 'next/server'
import { draftMode } from 'next/headers'
import { isSameOriginPost } from '@/lib/staging/rules'

/**
 * POST /api/admin/preview/exit
 *
 * Turns draft mode off and returns to the staging page. POST from a form on
 * this site only: a GET link could be prefetched and clear the preview by
 * accident (Next.js draft mode guide). No admin check is needed to turn the
 * preview off.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginPost(request.headers.get('origin'), request.headers.get('sec-fetch-site'), request.url)) {
    return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 })
  }
  ;(await draftMode()).disable()
  return NextResponse.redirect(new URL('/admin/staging', request.url), 303)
}
