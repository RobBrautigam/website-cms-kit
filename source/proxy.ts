import { NextResponse, after, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { lookupRedirect, recordHit } from "@/lib/redirects/lookup";
import { buildRedirectTarget } from "@/lib/redirects/build-target";
import { isBot } from "@/lib/redirects/bot-detect";

/**
 * Next.js 16 Proxy (the file formerly known as middleware.ts).
 *
 * Two responsibilities, in order:
 *
 *   0. URL redirect lookup against the Supabase-backed `url_redirects` table.
 *      This is the runtime half of the Redirects CMS resource. Returns a
 *      single-hop 307/308 on match. Telemetry is split by destination:
 *        - Internal (relative path): set a short-lived `r=<id>` cookie that a
 *          <RedirectBeacon> on the destination page reads and POSTs to
 *          /api/redirects/hit/[id].
 *        - External (absolute URL): redirect directly and log the hit via
 *          Next 16's `after()` so it never adds latency. A single hop matters
 *          so downstream resolvers (link previewers, calendar integrations)
 *          that follow at most one redirect can still find the real target.
 *      Skipped for /admin and /api so it never shadows an auth-gated or
 *      framework-internal route. This entire block is OPTIONAL: delete it if
 *      you are not shipping the Redirects resource.
 *
 *   1. Supabase auth gating for /admin/*: refresh the session cookie and bounce
 *      unauthenticated requests to /admin/login. See lib/supabase/middleware.ts.
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 0. Optional redirect lookup (Redirects CMS resource). Skip admin/api so we
  //    don't redirect over auth-gated or framework-internal routes.
  const skipRedirectLookup =
    pathname.startsWith("/admin") || pathname.startsWith("/api");

  if (!skipRedirectLookup) {
    try {
      const hit = await lookupRedirect(pathname);
      if (hit) {
        const { target, cookie } = buildRedirectTarget(hit);
        const isExternal = /^https?:\/\//.test(target);
        const absoluteTarget = isExternal
          ? target
          : new URL(target, request.url).toString();
        const res = NextResponse.redirect(
          absoluteTarget,
          hit.permanent ? 308 : 307
        );
        if (cookie) {
          res.cookies.set({
            name: cookie.name,
            value: cookie.value,
            maxAge: cookie.maxAge,
            path: "/",
            sameSite: "lax",
            httpOnly: false, // the beacon reads this from JS
          });
        }
        // External destinations record the hit via after() so logging never
        // adds latency. Bot UAs are filtered to keep hit_count meaningful.
        if (isExternal && !isBot(request.headers.get("user-agent"))) {
          after(async () => {
            try {
              await recordHit(hit.id);
            } catch {
              // Best-effort.
            }
          });
        }
        return res;
      }
    } catch {
      // Transient lookup failure: fall through to the rest of the chain.
    }
  }

  // 1. Admin auth gating.
  if (pathname.startsWith("/admin")) {
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  // Run on app routes; skip Next internals, API, and static assets.
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
