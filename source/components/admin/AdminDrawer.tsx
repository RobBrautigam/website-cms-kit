'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '@/lib/a11y/useFocusTrap'
import { useBodyScrollLock } from '@/lib/a11y/useBodyScrollLock'
import { usePrefersReducedMotion } from '@/lib/a11y/usePrefersReducedMotion'
import AdminSidebar from './AdminSidebar'

interface AdminDrawerProps {
  open: boolean
  onClose: () => void
  userEmail: string
  userRole: string
}

/**
 * Off-canvas mobile drawer that wraps AdminSidebar in a portal, with a
 * fading backdrop, slide-in animation, focus trap, body scroll lock,
 * and Escape/backdrop dismiss.
 */
export default function AdminDrawer({
  open,
  onClose,
  userEmail,
  userRole,
}: AdminDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const reducedMotion = usePrefersReducedMotion()

  useFocusTrap({ containerRef: panelRef, active: open, onEscape: onClose })
  useBodyScrollLock(open)

  // Defer createPortal until after hydration. The portal target is
  // `document.body`, which doesn't exist during SSR. Returning null on the
  // first server + client render keeps hydration markup consistent; the effect
  // then flips `mounted` and the portal renders on the next render. This is
  // the canonical Next.js App Router pattern for body-portaled overlays.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) return null

  // Animate only the properties that actually change — backdrop fades, panel
  // slides. Avoids unintended transitions on theme/border changes that
  // `transition-all` would catch, and is compositor-only (cheaper).
  const backdropTransition = reducedMotion ? 'transition-none' : 'transition-opacity duration-200 ease-out'
  const panelTransition = reducedMotion ? 'transition-none' : 'transition-transform duration-200 ease-out'

  return createPortal(
    <div className="md:hidden">
      {/* Backdrop */}
      <div
        data-testid="admin-drawer-backdrop"
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 bg-black/50 z-50 ${backdropTransition} ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />
      {/* Drawer panel — drop role="dialog" when closed so screen readers don't
          announce a hidden dialog (an aria-hidden dialog is a known anti-pattern).
          `inert` removes the panel + descendants from the keyboard tab order
          AND the screen-reader tree when closed, which `aria-hidden` alone does
          not (aria-hidden hides from AT only — focusable children stay tabbable).
          The id targets the AdminShell hamburger's `aria-controls`. */}
      <div
        id="admin-drawer"
        ref={panelRef}
        data-testid="admin-drawer-panel"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? 'true' : undefined}
        aria-hidden={open ? undefined : 'true'}
        aria-labelledby={open ? 'admin-drawer-title' : undefined}
        inert={!open}
        className={`fixed top-0 left-0 bottom-0 w-[280px] z-[51] bg-bg-card border-r border-border ${panelTransition} ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* sr-only heading provides the dialog's accessible name without
            relying on a visible-element id that AdminSidebar would also render
            in the desktop sidebar (would cause duplicate-id resolution). */}
        {open && (
          <h2 id="admin-drawer-title" className="sr-only">
            Admin navigation
          </h2>
        )}
        <AdminSidebar
          userEmail={userEmail}
          userRole={userRole}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  )
}
