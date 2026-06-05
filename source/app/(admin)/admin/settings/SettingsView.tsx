'use client'

import { useState } from 'react'
import Link from 'next/link'
import ChangePassword from '@/components/admin/ChangePassword'
import { TwoFactorSection } from '@/components/admin/TwoFactorSection'
import type { AdminRole } from '@/lib/auth/types'

export default function SettingsView({
  email,
  role,
  factors,
}: {
  email: string
  role: AdminRole
  factors: { id: string; status: string; created_at: string }[]
}) {
  const [showPasswordModal, setShowPasswordModal] = useState(false)

  const roleLabel = role === 'super_admin' ? 'Super Admin' : 'Admin'
  const roleHint =
    role === 'super_admin'
      ? 'Full access. You can manage team members, change roles, and deactivate accounts.'
      : 'Full CMS access (posts, jobs, testimonials, redirects). Team management is restricted to super-admins.'

  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1
          className="text-2xl font-black tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          SETTINGS
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Your account.
        </p>
      </div>

      {/* Account section */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary/60 mb-3">
          Account
        </h2>
        <div className="border border-border rounded-xl divide-y divide-border">
          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-0.5">Email</p>
              <p className="text-sm text-text-primary truncate">{email}</p>
            </div>
          </div>

          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-0.5">Role</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                    role === 'super_admin'
                      ? 'bg-accent/10 text-accent'
                      : 'bg-blue-500/10 text-blue-600'
                  }`}
                >
                  {roleLabel}
                </span>
              </div>
              <p className="text-[11px] text-text-secondary/70 mt-1.5 leading-snug">{roleHint}</p>
            </div>
          </div>

          <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-text-secondary uppercase tracking-wider mb-0.5">Password</p>
              <p className="text-sm text-text-primary">Change your password.</p>
            </div>
            <button
              onClick={() => setShowPasswordModal(true)}
              className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card transition-colors"
            >
              Change password
            </button>
          </div>
        </div>
      </section>

      <TwoFactorSection initialFactors={factors} />

      {role === 'super_admin' && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary/60 mb-3">
            Team
          </h2>
          <div className="border border-border rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-text-secondary">
              Manage team members, invite new admins, and change roles.
            </p>
            <Link
              href="/admin/team"
              className="px-4 py-2 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card transition-colors"
            >
              Open Team
            </Link>
          </div>
        </section>
      )}

      {showPasswordModal && (
        <ChangePassword onClose={() => setShowPasswordModal(false)} />
      )}
    </div>
  )
}
