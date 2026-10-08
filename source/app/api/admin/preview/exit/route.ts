import { NextResponse, type NextRequest } from 'next/server'
import { draftMode } from 'next/headers'
import { crossSiteRefusal } from '@/lib/security/request-origin'

/**
 * POST /api/admin/preview/exit
 *
 * Turns draft mode off and returns to the staging page. POST from a form on
 * this site only: a GET link could be prefetched and clear the preview by
 * accident (Next.js draft mode guide). No admin check is needed to turn the
 * preview off.
 */
export async function POST(request: NextRequest) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  ;(await draftMode()).disable()
  return new NextResponse(null, { status: 303, headers: { Location: '/admin/staging' } })
}
