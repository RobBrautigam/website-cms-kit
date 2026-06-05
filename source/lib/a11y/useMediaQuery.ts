import { useSyncExternalStore } from "react";

/**
 * Hydration-safe media query hook. Subscribes via `useSyncExternalStore` so
 * the value updates on viewport changes without effect-driven re-render.
 *
 * On the server we cannot know the viewport, so the server snapshot returns
 * `false`. Components that want the desktop-default rendering should branch on
 * the *complement* of a mobile query (e.g., `!useMediaQuery("(max-width: 767px)")`
 * → true on the server, true on desktop, false on mobile after first paint).
 *
 * For the AdminShell Toaster placement we use `(min-width: 768px)` and accept
 * a one-frame default-to-mobile-position layout on the server, since the
 * Toaster doesn't render any markup until a toast is dispatched anyway.
 *
 * Client-side only. Must be called from a `'use client'` component.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", notify);
        return () => mql.removeEventListener("change", notify);
      }
      // Legacy Safari < 14
      mql.addListener(notify);
      return () => mql.removeListener(notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
