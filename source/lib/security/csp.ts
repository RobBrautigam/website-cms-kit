import { buildCsp, cspEnforced, cspHeaderName, newNonce } from './headers'

/**
 * The Content Security Policy for one request, from the environment:
 *   CSP_MODE=enforce   block instead of report (default: report only)
 *   CSP_SCOPE=site     every page, not only /admin (default: admin)
 *   CSP_REPORT_URI     where browsers send violation reports (optional)
 *
 * The admin is always dynamically rendered, so every script there carries
 * the nonce and the reports are exact. Statically rendered public pages
 * carry no nonce, so with CSP_SCOPE=site they report Next.js's own inline
 * scripts until those pages render dynamically; that is why the public
 * pages are opt-in.
 */
export type RequestCsp = { name: string; value: string; nonce: string }

export function cspFor(pathname: string, env: Record<string, string | undefined> = process.env): RequestCsp | null {
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/')
  if (!isAdmin && env.CSP_SCOPE !== 'site') return null
  const nonce = newNonce()
  const enforce = cspEnforced(env.CSP_MODE)
  return {
    name: cspHeaderName(enforce),
    value: buildCsp({
      nonce,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      dev: env.NODE_ENV === 'development',
      enforce,
      reportUri: env.CSP_REPORT_URI,
    }),
    nonce,
  }
}

/**
 * The request headers to forward: Next.js reads the nonce from the policy
 * header on the request and stamps it on its own scripts; `x-nonce` lets a
 * server component read it (headers().get('x-nonce')) for a script of yours.
 */
export function forwardWithCsp(requestHeaders: Headers, csp: RequestCsp | null): Headers {
  const headers = new Headers(requestHeaders)
  if (csp) {
    headers.set(csp.name, csp.value)
    headers.set('x-nonce', csp.nonce)
  }
  return headers
}
