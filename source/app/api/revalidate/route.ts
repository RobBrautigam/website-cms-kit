import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require'

export async function POST() {
  // Admin-only: /api/* is not proxy-gated. Without this, anyone could force
  // repeated cache purges of the blog routes (cheap origin-load DoS).
  await requireAdmin()
  try {
    revalidatePath('/blog', 'page')
    revalidatePath('/blog/[slug]', 'page')
    return NextResponse.json({ revalidated: true })
  } catch {
    return NextResponse.json({ error: 'Revalidation failed' }, { status: 500 })
  }
}
