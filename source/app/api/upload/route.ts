import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, newImagePath } from '@/lib/admin/upload-image'

// An optional server-side upload path: nothing in the kit calls it (the
// editor uploads from the browser through lib/admin/upload-image.ts). It
// shares that helper's type list (MIME -> extension, also the allowlist),
// size cap and file naming, so the two paths can never disagree.

export async function POST(request: NextRequest) {
  // Admin-only. Every other mutating route gates with requireAdmin; the proxy
  // does not cover /api/*, so gate here (not just "is logged in").
  await requireAdmin()
  const supabase = await createServerSupabaseClient()

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  // Validate type via MIME (the allowlist) and derive the extension from it,
  // NOT from the user-supplied filename.
  const ext = IMAGE_TYPES[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' }, { status: 400 })
  }

  // Validate file size (5MB max)
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'File too large. Maximum 5MB' }, { status: 400 })
  }
  const filePath = newImagePath(ext)

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error } = await supabase.storage
    .from('blog-images')
    .upload(filePath, buffer, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    })

  if (error) {
    return NextResponse.json({ error: 'Upload failed: ' + error.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('blog-images')
    .getPublicUrl(filePath)

  return NextResponse.json({ url: publicUrl })
}
