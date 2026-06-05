import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method is called from a Server Component
            // where cookies can't be set. This can be ignored if middleware
            // refreshes sessions.
          }
        },
      },
    }
  )
}

/**
 * Service-role client for server contexts that genuinely need to bypass RLS
 * (admin mutations, internal API routes acting on behalf of trusted callers).
 *
 * DO NOT use this for SSG / build-time data fetching of public data —
 * exposing SUPABASE_SERVICE_ROLE_KEY to the CI build environment is a P1
 * security issue (a malicious PR could exfiltrate the key). Use
 * `createAnonServerClient()` instead and rely on the table's RLS policy
 * to surface only public-readable rows.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Anon-key server client for SSG / build-time data fetching of public data.
 *
 * Uses the public anon key (already exposed in client-side JS bundles, so
 * safe in CI build env). Subject to RLS — caller must ensure target table
 * has an appropriate `TO anon ... USING (...)` policy. Examples:
 *   - blog_posts:  anon can read WHERE status = 'published'
 *   - job_openings: anon can read WHERE is_active = true
 */
export function createAnonServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
