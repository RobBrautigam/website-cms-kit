import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/require'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { STAGED_BUCKET, isImagePath } from '@/lib/staging/images'

/**
 * GET /api/admin/staged-image?path=blog/<id>.<ext>
 *
 * An image that is not public yet (lib/staging/images.ts) is shown on the
 * admin screens through this route: it sends an active, two-factor admin to
 * a signed link that lasts five minutes. The signing runs on the admin's own
 * session, so the staged bucket's policies (migration 002, section 18) decide.
 * Read-only, so no same-site check is needed.
 */
export async function GET(request: NextRequest) {
  await requireAdmin()
  const path = request.nextUrl.searchParams.get('path')
  if (!isImagePath(path)) {
    return NextResponse.json({ error: 'Not an image path.' }, { status: 400 })
  }
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.storage.from(STAGED_BUCKET).createSignedUrl(path, 300)
  if (error || !data?.signedUrl) {
    return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  return new NextResponse(null, {
    status: 302,
    headers: { Location: data.signedUrl, 'Cache-Control': 'private, no-store' },
  })
}
