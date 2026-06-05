'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import ChangePassword from './ChangePassword'
import { APP_VERSION } from '@/lib/version'
import { LogoMark } from '@/components/LogoMark'

type NavItem = {
  href: string
  label: string
  icon: string
  /** Indent this item visually (sub-entry under a parent). */
  indent?: boolean
  /** Render for admin OR super_admin. */
  adminOnly?: boolean
  /** Render only for super_admin (e.g. Team management). */
  superAdminOnly?: boolean
  /** Render a small "Beta" pill next to the label. */
  betaPill?: boolean
}

type NavSection = {
  title: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    title: 'Content',
    items: [
      { href: '/admin/posts', label: 'Posts', icon: '📝' },
      { href: '/admin/jobs', label: 'Jobs', icon: '💼' },
      { href: '/admin/testimonials', label: 'Testimonials', icon: '💬' },
    ],
  },
  {
    title: 'Site',
    items: [
      { href: '/admin/redirects', label: 'Redirects', icon: '🔀' },
      { href: '/admin/sitemap', label: 'Sitemap', icon: '🗺️' },
    ],
  },
  {
    title: 'Organization',
    items: [
      { href: '/admin/team', label: 'Team', icon: '👥', superAdminOnly: true },
      { href: '/admin/settings', label: 'Settings', icon: '⚙️', adminOnly: true },
    ],
  },
  {
    title: 'Audit & Compliance',
    items: [
      { href: '/admin/audit-log', label: 'Audit Log', icon: '📋', superAdminOnly: true },
    ],
  },
]

export default function AdminSidebar({
  userEmail,
  userRole,
  onClose,
}: {
  userEmail: string
  userRole: string
  /** When provided, sidebar is rendered inside the mobile drawer; render close
   *  button in the header and dismiss the drawer when a nav link is tapped. */
  onClose?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [showPasswordModal, setShowPasswordModal] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <>
      <aside className="w-60 border-r border-border bg-bg-card flex flex-col h-full">
        {/* Logo */}
        <div className="p-5 border-b border-border flex items-center justify-between gap-3">
          <Link
            href="/admin/posts"
            onClick={onClose}
            className="flex items-center gap-1.5"
          >
            <LogoMark size={34} className="text-accent w-[34px] h-[34px] -translate-y-[1px]" />
            <span className="font-black text-sm tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Acme Admin
            </span>
          </Link>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="p-2 -mr-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          )}
        </div>

        {/* Sectioned nav */}
        <nav className="flex-1 p-3 overflow-y-auto">
          {navSections.map((section, index) => {
            const visibleItems = section.items.filter((item) => {
              if (item.superAdminOnly) return userRole === 'super_admin'
              if (item.adminOnly) return userRole === 'super_admin' || userRole === 'admin'
              return true
            })
            if (visibleItems.length === 0) return null
            return (
              <div key={section.title} className={index === 0 ? '' : 'mt-6'}>
                <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-secondary/60 font-semibold">
                  {section.title}
                </p>
                <ul className="space-y-1 mt-1">
                  {visibleItems.map((item) => {
                    const isActive =
                      pathname === item.href || pathname.startsWith(item.href + '/')
                    const paddingLeft = item.indent ? 'pl-8' : 'px-3'
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={`flex items-center gap-3 ${paddingLeft} pr-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-accent/10 text-accent'
                              : 'text-text-secondary hover:text-text-primary hover:bg-bg-white/50'
                          }`}
                        >
                          <span>{item.icon}</span>
                          <span className="flex-1">{item.label}</span>
                          {item.betaPill && (
                            <span
                              className="ml-auto text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-text-secondary/15 text-text-secondary"
                              aria-label="Beta"
                            >
                              Beta
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        {/* Meta-nav: Help. Visible to admin + super_admin. */}
        {(userRole === 'admin' || userRole === 'super_admin') && (
          <div className="px-3 pt-3 pb-1 border-t border-border">
            <Link
              href="/admin/help"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 pr-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === '/admin/help' || pathname.startsWith('/admin/help/')
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-white/50'
              }`}
            >
              <span>❓</span>
              <span className="flex-1">Help</span>
            </Link>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-1">
          <div className="px-3 pb-3 mb-2 border-b border-border">
            <p className="text-xs text-text-primary font-medium truncate">{userEmail}</p>
            <p
              className={`text-[10px] uppercase tracking-wider mt-0.5 ${
                userRole === 'super_admin'
                  ? 'text-accent font-bold'
                  : 'text-text-secondary/60'
              }`}
            >
              {userRole === 'super_admin' ? 'SUPER ADMIN' : userRole.toUpperCase()}
            </p>
          </div>

          <button
            onClick={() => setShowPasswordModal(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-text-secondary cursor-pointer hover:text-text-primary hover:bg-accent/10 active:scale-[0.98] transition-all duration-150"
          >
            <span className="w-4 text-center shrink-0">🔑</span>
            Change Password
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-text-secondary cursor-pointer hover:text-red-500 hover:bg-red-500/10 active:scale-[0.98] transition-all duration-150"
          >
            <span className="w-4 text-center shrink-0">🚪</span>
            Sign Out
          </button>

          <p className="px-3 pt-2 text-[10px] text-text-secondary/40">{APP_VERSION}</p>
        </div>
      </aside>

      {showPasswordModal && (
        <ChangePassword onClose={() => setShowPasswordModal(false)} />
      )}
    </>
  )
}
