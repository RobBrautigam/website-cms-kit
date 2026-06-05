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
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAdminRoute = pathname.startsWith('/admin')
  // Public auth pages that don't require an existing session.
  // /admin/login           — sign in
  // /admin/forgot-password — request a recovery email
  // /admin/reset-password  — set new password (consumes Supabase recovery code)
  const isPublicAuthPage =
    pathname === '/admin/login' ||
    pathname === '/admin/forgot-password' ||
    pathname === '/admin/reset-password'

  if (isAdminRoute && !isPublicAuthPage && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/login'
    return NextResponse.redirect(url)
  }

  // If the user is already authenticated and visits the login page (no
  // recovery code in flight), bounce to the dashboard. We DON'T bounce
  // on /admin/reset-password because a logged-in user might legitimately
  // be in the middle of a magic-link callback that just established the
  // session — they still need to set their password.
  if (pathname === '/admin/login' && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/posts'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
