/**
 * The one link allowlist, shared by the editor (at entry) and the public
 * renderer (at output): web, mail and phone links, same-site paths and
 * anchors. Refuses javascript:, data: and vbscript: (stored XSS), and also
 * protocol-relative "//host" and "/\host", which browsers treat as off-site.
 */
const SAFE_HREF = /^(https?:|mailto:|tel:|\/(?![/\\])|#)/i

export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href)
}
