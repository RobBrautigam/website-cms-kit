import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Refreshes the Supabase auth session on every /admin/* request and gates
 * access. Called from proxy.ts. Splitting this out keeps the proxy readable
 * and lets you unit-test the gating logic in isolation.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        // `headers` (from @supabase/ssr 0.10) carries the no-store cache
        // headers that must travel with a refreshed session cookie, so a CDN
        // never serves one visitor's session to another. Left untyped on
        // purpose: its type comes from the library, so an older @supabase/ssr
        // fails the type check instead of silently dropping the headers.
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headers ?? {}).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  // getClaims() verifies the JWT signature (locally when the project uses
  // asymmetric signing keys) and refreshes an expired session. This is
  // Supabase's recommended check for the proxy; never trust getSession()
  // here, it reads the cookie without verifying it. requireAdmin() still
  // makes the authoritative user, role, deactivation and MFA check on every
  // protected render and mutation.
  const { data } = await supabase.auth.getClaims()
  const isSignedIn = Boolean(data?.claims)

  const pathname = request.nextUrl.pathname
  const isAdminRoute = pathname.startsWith('/admin')
  // Public auth pages that don't require an existing session.
  // /admin/login           - sign in
  // /admin/forgot-password - request a recovery email
  // /admin/reset-password  - set new password (consumes Supabase recovery code)
  const isPublicAuthPage =
    pathname === '/admin/login' ||
    pathname === '/admin/forgot-password' ||
    pathname === '/admin/reset-password'

  if (isAdminRoute && !isPublicAuthPage && !isSignedIn) {
    return redirectKeepingSession(request, '/admin/login', supabaseResponse)
  }

  // If the user is already authenticated and visits the login page (no
  // recovery code in flight), bounce to the dashboard. We DON'T bounce
  // on /admin/reset-password because a logged-in user might legitimately
  // be in the middle of a magic-link callback that just established the
  // session - they still need to set their password.
  //
  // Confirm with getUser() first. Valid claims only prove the token was
  // signed and has not expired; a session revoked server-side (signed out on
  // another device, a deactivated admin, a non-admin that requireAdmin()
  // just signed out) still carries valid claims until the token expires.
  // requireAdmin() rejects it with getUser() and redirects here, so bouncing
  // on claims alone would loop between the two. This costs one Auth call,
  // only when a signed-in browser opens the login page.
  if (pathname === '/admin/login' && isSignedIn) {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      return redirectKeepingSession(request, '/admin/posts', supabaseResponse)
    }
  }

  return supabaseResponse
}

/**
 * A redirect is a brand-new response. Copy over any cookies and cache headers
 * the session refresh just wrote, or the browser keeps the stale session and
 * the next request refreshes (and rotates the refresh token) all over again.
 */
function redirectKeepingSession(
  request: NextRequest,
  pathname: string,
  from: NextResponse
) {
  const url = request.nextUrl.clone()
  url.pathname = pathname
  const response = NextResponse.redirect(url)
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = from.headers.get(header)
    if (value) response.headers.set(header, value)
  }
  return response
}
