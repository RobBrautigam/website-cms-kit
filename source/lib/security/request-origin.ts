/**
 * The one same-site check for every cookie-authorized route that changes
 * something (the admin API, the AI routes, uploads, revalidation and the
 * preview switch).
 *
 * The admin session cookie is SameSite=Lax, which already keeps it off a
 * cross-site POST in every current browser. This check is the second lock:
 * a request must also prove it came from a page on this site, through the
 * browser-set Origin header, or Sec-Fetch-Site when Origin is opaque. Server
 * Actions get the same check from Next.js itself; route handlers do not, so
 * each one calls `crossSiteRefusal()` before anything else.
 *
 * Pure (Web-standard Request and Response only), so it runs under the
 * plain-Node tests with no Next.js server.
 */

/**
 * `origin` is the request's Origin header, `fetchSite` its Sec-Fetch-Site
 * header, `siteOrigin` this site's public origin (see `publicOrigin`).
 */
export function isSameOriginPost(origin: string | null, fetchSite: string | null, siteOrigin: string): boolean {
  if (origin && origin !== 'null') return origin === new URL(siteOrigin).origin
  return fetchSite === 'same-origin'
}

/**
 * The site's public origin. Under `next start` behind a proxy, a route's
 * `request.url` carries the server's bind address (http://localhost:3000),
 * not the address the browser used, so compare against the proxy's
 * X-Forwarded-Host (first value), then the Host header, then the URL.
 * A cross-site form cannot set either header, so this does not weaken the
 * same-origin check.
 */
export function publicOrigin(
  forwardedHost: string | null,
  forwardedProto: string | null,
  host: string | null,
  requestUrl: string
): string {
  const first = (v: string | null) => (v ? v.split(',')[0].trim() : '')
  const url = new URL(requestUrl)
  const fHost = first(forwardedHost)
  if (fHost) return `${first(forwardedProto) || 'https'}://${fHost}`
  const h = first(host)
  if (h) return `${url.protocol}//${h}`
  return url.origin
}

/** This site's public origin for a request (also the base for emailed links). */
export function siteOriginOf(request: Request): string {
  const h = request.headers
  return publicOrigin(h.get('x-forwarded-host'), h.get('x-forwarded-proto'), h.get('host'), request.url)
}

/**
 * Null when the request came from a page on this site; otherwise the 403 to
 * return. Call it first in every state-changing route handler, before the
 * auth check, so a cross-site request learns nothing about the session.
 */
export function crossSiteRefusal(request: Request): Response | null {
  const h = request.headers
  if (isSameOriginPost(h.get('origin'), h.get('sec-fetch-site'), siteOriginOf(request))) return null
  return Response.json({ error: 'Cross-site request refused.' }, { status: 403 })
}
