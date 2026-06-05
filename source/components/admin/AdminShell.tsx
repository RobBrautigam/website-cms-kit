'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { Toaster } from 'sonner'
import AdminSidebar from './AdminSidebar'
import AdminDrawer from './AdminDrawer'
import { useMediaQuery } from '@/lib/a11y/useMediaQuery'

export default function AdminShell({
  children,
  userEmail,
  userRole,
  fullWidth = false,
}: {
  children: React.ReactNode
  userEmail: string
  userRole: string
  /** When true, skip the inner max-w-6xl constraint so the page controls its own width (full-bleed tools/pages). */
  fullWidth?: boolean
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // Auto-close the drawer on route change. Next.js App Router exposes
  // navigation only through `usePathname`; there is no event handler we can
  // attach to "navigation completed", so an effect on pathname is the
  // canonical pattern. setDrawerOpen(false) is a no-op when already false
  // (Object.is short-circuit), so no cascading-render risk.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false)
  }, [pathname])

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      {/* Desktop sidebar (≥md) */}
      <div className="hidden md:flex">
        <AdminSidebar userEmail={userEmail} userRole={userRole} />
      </div>

      <div className="flex-1 flex flex-col md:overflow-y-auto">
        {/* Mobile top bar (<md) */}
        <header className="md:hidden sticky top-0 z-40 bg-bg-card border-b border-border h-14 flex items-center px-4 gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="admin-drawer"
            className="p-2 -ml-2 rounded-lg text-text-primary hover:bg-bg-elevated focus:outline-none focus:ring-2 focus:ring-accent"
          >
            <Menu size={24} strokeWidth={1.75} />
          </button>
          <span
            className="font-black text-sm tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Acme Admin
          </span>
        </header>

        <main className="flex-1 bg-bg-white">
          {fullWidth ? children : (
            <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">{children}</div>
          )}
        </main>
      </div>

      <AdminDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userEmail={userEmail}
        userRole={userRole}
      />

      {/* Toast region. Top-right on desktop; top-center on mobile so it
          doesn't crowd the page title at 375px viewport. richColors gives
          green/red backgrounds for success/error; closeButton lets the team
          dismiss errors that need re-reading. */}
      <Toaster
        richColors
        closeButton
        position={isDesktop ? 'top-right' : 'top-center'}
        theme="system"
        visibleToasts={3}
      />
    </div>
  )
}
