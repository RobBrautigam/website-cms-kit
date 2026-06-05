'use client'

import { useRef, type ReactNode } from 'react'
import { useFocusTrap } from '@/lib/a11y/useFocusTrap'

interface ModalShellProps {
  onClose: () => void
  /** ID of the heading element inside the modal — wired to aria-labelledby. */
  ariaLabelledBy: string
  /** Override the default panel class (defaults to max-w-md). */
  panelClassName?: string
  children: ReactNode
}

/**
 * Accessibility-correct wrapper for admin modals. Provides focus trap, escape
 * dismiss, backdrop click dismiss, focus return, and dialog ARIA wiring.
 *
 * Focus trap behavior is shared with AdminDrawer via the useFocusTrap hook.
 */
export default function ModalShell({
  onClose,
  ariaLabelledBy,
  panelClassName = 'bg-bg-white border border-border rounded-2xl p-6 w-full max-w-md shadow-xl',
  children,
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: dialogRef, active: true, onEscape: onClose })

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  )
}
