import type { RedirectMatch } from "./types";

/**
 * Cookie name used to propagate the matched redirect's id from the proxy
 * to the destination page, where the client-side beacon picks it up and
 * fires telemetry.
 *
 * Kept short to minimize header bytes on every redirect response.
 */
export const REDIRECT_COOKIE_NAME = "app_r";

/**
 * Maximum age of the redirect cookie in seconds. The browser only needs
 * to carry it from the redirect response to the destination page render,
 * which is sub-second in practice. Setting a generous 30s bound covers
 * slow connections without leaving the cookie around long enough to
 * matter for any subsequent navigation.
 */
export const REDIRECT_COOKIE_MAX_AGE = 30;

export interface RedirectTarget {
  /** Absolute URL or absolute path to issue the 307/308 to. */
  target: string;

  /**
   * If set, the proxy should attach this cookie to the redirect response.
   * Only present for INTERNAL redirects (telemetry uses a destination-page
   * beacon). External redirects record their hit via Next 16's `after()`
   * in the proxy itself, so no cookie is needed.
   */
  cookie: { name: string; value: string; maxAge: number } | null;
}

const EXTERNAL_RE = /^https?:\/\//;

/**
 * Decide what URL the proxy should redirect to and whether to set a
 * telemetry cookie.
 *
 * Internal destinations (relative paths) → return the destination as-is
 * with a telemetry cookie. The destination page's beacon picks up the
 * cookie and fires the hit count POST.
 *
 * External destinations (absolute URLs) → return the destination as-is
 * with no cookie. The proxy issues a single-hop redirect directly to the
 * external URL and schedules telemetry via Next 16's `after()`. Single-hop
 * is required so downstream resolvers (e.g. calendar integrations, Zoom
 * links, link previewers) that follow at most one redirect can reach the
 * underlying meeting URL.
 *
 * Pure function — no side effects. The proxy attaches the cookie to its
 * NextResponse.
 */
export function buildRedirectTarget(match: RedirectMatch): RedirectTarget {
  const isExternal = EXTERNAL_RE.test(match.destination);

  if (isExternal) {
    return {
      target: match.destination,
      cookie: null,
    };
  }

  return {
    target: match.destination,
    cookie: {
      name: REDIRECT_COOKIE_NAME,
      value: match.id,
      maxAge: REDIRECT_COOKIE_MAX_AGE,
    },
  };
}
