import { useEffect, useRef } from 'react'

interface UseFocusTrapOptions {
  containerRef: React.RefObject<HTMLElement | null>
  active: boolean
  onEscape: () => void
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Focus-trap hook for modal-like surfaces (modals, drawers, command palettes).
 *
 * Behavior:
 *   - Escape key calls `onEscape()`
 *   - Tab / Shift+Tab cycle focus within `containerRef`, never escaping into
 *     the background page
 *   - On deactivation (or unmount), focus returns to whatever element was
 *     focused at the moment activation began
 *   - Completely no-op when `active` is false
 *
 * Client-side only. Must be called from a `'use client'` component because it
 * attaches a `window` event listener and reads `document.activeElement`.
 *
 * Used by ModalShell and AdminDrawer.
 */
export function useFocusTrap({
  containerRef,
  active,
  onEscape,
}: UseFocusTrapOptions): void {
  const previouslyFocused = useRef<HTMLElement | null>(null)
  // Mirror the latest onEscape into a ref so the effect doesn't re-subscribe
  // (and re-snapshot previouslyFocused) on every render when callers pass an
  // inline arrow. Important for AdminDrawer, which toggles `active` while the
  // parent component re-renders frequently.
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  }, [onEscape])

  useEffect(() => {
    if (!active) return

    previouslyFocused.current = document.activeElement as HTMLElement | null

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscapeRef.current()
        return
      }
      if (e.key !== 'Tab' || !containerRef.current) return

      const focusable = containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') {
        prev.focus()
      }
    }
  }, [active, containerRef])
}
