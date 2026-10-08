import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The one upload path for admin images (the editor's inline images and the
 * featured-image picker both call it).
 *
 * The browser checks here are for a fast, friendly error. The real limits are
 * server-side: the bucket's own size and MIME settings, and the Storage RLS
 * policies in the migration (section 9) that only let an active admin write.
 */
export const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES).join(',')
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const BUCKET = 'blog-images'

export type UploadResult = { url: string } | { error: string }

/**
 * A random object path for an image of the given extension. randomUUID()
 * exists only on secure origins (HTTPS or localhost), so fall back to
 * getRandomValues(), which works on any origin (a phone testing a LAN address).
 */
export function newImagePath(ext: string): string {
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, '0')
        ).join('')
  return `blog/${id}.${ext}`
}

export async function uploadBlogImage(
  supabase: SupabaseClient,
  file: File
): Promise<UploadResult> {
  // The extension comes from the checked MIME type, never from the file
  // name, so a stored object's name always matches what it is served as.
  const ext = IMAGE_TYPES[file.type]
  if (!ext) return { error: 'Only JPEG, PNG, WebP or GIF images can be uploaded.' }
  if (file.size > MAX_IMAGE_BYTES) return { error: 'Images must be 5 MB or smaller.' }

  const path = newImagePath(ext)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) return { error: `Upload failed: ${error.message}` }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: publicUrl }
}
