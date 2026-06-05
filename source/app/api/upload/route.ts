import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/require'

// MIME -> extension. Also serves as the type allowlist: a file whose MIME
// isn't a key here is rejected. The extension is derived from this, never from
// the client-supplied filename.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

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
  const ext = MIME_EXT[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' }, { status: 400 })
  }

  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large. Maximum 5MB' }, { status: 400 })
  }
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const filePath = `blog/${fileName}`

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
