import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(notify: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', notify)
    return () => mql.removeEventListener('change', notify)
  }
  // Legacy browsers (Safari < 14)
  mql.addListener(notify)
  return () => mql.removeListener(notify)
}

function getClientSnapshot(): boolean {
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot(): boolean {
  // Server cannot know the user's motion preference. Default to "motion allowed"
  // so SSR markup matches the most common case; the real value resolves on the
  // client and the hook re-renders if it differs.
  return false
}

/**
 * Returns `true` when the user has requested reduced motion via their OS
 * accessibility settings (`prefers-reduced-motion: reduce`). Subscribes to
 * changes so the value updates if the user toggles the setting at runtime.
 *
 * Client-side only. Must be called from a `'use client'` component because it
 * touches `window.matchMedia` via `useSyncExternalStore`'s client snapshot.
 *
 * Used by AdminDrawer (and any future animated overlay) to swap slide-in
 * transitions for instant transitions when the user has reduced motion on.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
