"use client";

import { useEffect } from "react";
import { REDIRECT_COOKIE_NAME } from "@/lib/redirects/build-target";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the `app_r=<id>` cookie that the proxy attaches to internal-redirect
 * responses, deletes it, and POSTs to /api/redirects/hit/[id] for telemetry.
 *
 * Mount this once in the public site's root layout (it is OPTIONAL — only
 * needed if you want per-hit counts on INTERNAL redirects; external redirects
 * are logged directly from the proxy). No-op when the cookie is absent.
 *
 * The cookie is deleted SYNCHRONOUSLY before the fetch fires, so a double
 * mount in React strict mode (dev) cannot double-count.
 */
export function RedirectBeacon() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const cookies = document.cookie ? document.cookie.split("; ") : [];
    const prefix = `${REDIRECT_COOKIE_NAME}=`;
    const entry = cookies.find((c) => c.startsWith(prefix));
    if (!entry) return;

    const value = entry.slice(prefix.length);
    // Delete the cookie atomically before firing — protects against
    // strict-mode double-mount and any reload race.
    document.cookie = `${REDIRECT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;

    if (!UUID_RE.test(value)) return;

    // Fire-and-forget telemetry. keepalive lets the request survive
    // navigation away from this page.
    fetch(`/api/redirects/hit/${value}`, {
      method: "POST",
      keepalive: true,
      credentials: "omit",
    }).catch(() => {
      // Best-effort. Failures are silent.
    });
  }, []);

  return null;
}
