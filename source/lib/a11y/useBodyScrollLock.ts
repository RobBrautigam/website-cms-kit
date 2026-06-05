import { useEffect } from 'react'

let lockCount = 0
let priorOverflow: string | null = null

/**
 * Locks `document.body` scroll while `active` is true. Stacks safely across
 * multiple consumers via reference counting — the first lock captures the
 * existing `overflow` value, the last unlock restores it.
 *
 * Client-side only. Must be called from a `'use client'` component because it
 * reads/writes `document.body`.
 *
 * Used by AdminDrawer (and any future overlay that needs to block background
 * scrolling on mobile).
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    if (lockCount === 0) {
      priorOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount += 1

    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        document.body.style.overflow = priorOverflow ?? ''
        priorOverflow = null
      }
    }
  }, [active])
}

/**
 * Test-only helper. Resets module-level state so tests don't leak across each
 * other. Call from `beforeEach`. Not part of the production API.
 */
export function __resetBodyScrollLockForTests(): void {
  lockCount = 0
  priorOverflow = null
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }
}
