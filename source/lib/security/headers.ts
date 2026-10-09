/**
 * Security headers.
 *
 * Two halves:
 *   - SECURITY_HEADERS: the same on every response, so they live in
 *     next.config.ts `headers()`.
 *   - the Content Security Policy: it carries a fresh nonce per request, so
 *     the proxy (proxy.ts) builds it with `buildCsp()` and sets it on both the
 *     request (Next.js reads the nonce from it and stamps its own scripts) and
 *     the response.
 *
 * The policy ships REPORT-ONLY: the browser reports what it would have
 * blocked (in the console, and to CSP_REPORT_URI when set) and blocks
 * nothing. Watch the reports on your own site, then set CSP_MODE=enforce.
 * Next.js reads the nonce from either header name (checked against
 * next/src/server/app-render/parse-request-headers.ts on 2026-10-08).
 *
 * Nonces need a dynamically rendered page. The admin is dynamic already;
 * a statically rendered public page has no nonce on its scripts and will
 * report them, which is why enforcing is a deliberate step.
 */

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // HTTPS only, for two years, subdomains included. Harmless on localhost
  // (browsers ignore it over plain HTTP).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No framing anywhere (clickjacking). frame-ancestors in the CSP says the
  // same once it is enforced; a report-only policy cannot carry it.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

export type CspOptions = {
  nonce: string
  /** NEXT_PUBLIC_SUPABASE_URL: images, the REST API and Realtime live there. */
  supabaseUrl?: string
  /** `next dev` needs eval for React's debugging features. */
  dev?: boolean
  /** CSP_MODE=enforce turns the policy on; anything else reports only. */
  enforce?: boolean
  /** Optional CSP_REPORT_URI, a collector for violation reports. */
  reportUri?: string
}

export function cspEnforced(mode: string | undefined): boolean {
  return mode === 'enforce'
}

export function cspHeaderName(enforce: boolean): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'
}

export function buildCsp({ nonce, supabaseUrl, dev = false, enforce = false, reportUri }: CspOptions): string {
  let supabase = ''
  let realtime = ''
  if (supabaseUrl) {
    const u = new URL(supabaseUrl)
    supabase = u.origin
    realtime = `${u.protocol === 'http:' ? 'ws:' : 'wss:'}//${u.host}`
  }
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    // Tailwind, TipTap and next/font inline small style blocks.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'blob:', 'data:', ...(supabase ? [supabase] : [])]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...(supabase ? [supabase, realtime] : [])]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ]
  // Browsers ignore (and warn about) these two in a report-only policy.
  if (enforce) {
    directives.push(['frame-ancestors', ["'none'"]])
    if (!dev) directives.push(['upgrade-insecure-requests', []])
  }
  if (reportUri) directives.push(['report-uri', [reportUri]])
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ')
}

/** 128 random bits, base64. A fresh one for every request. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
