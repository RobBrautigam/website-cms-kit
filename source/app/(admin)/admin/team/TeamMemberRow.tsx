'use client'

import { useEffect, useRef, useState } from 'react'
import type { TeamMember } from '@/lib/auth/team-queries'

interface Props {
  member: TeamMember
  isCurrentUser: boolean
  activeSuperAdminCount: number
  onChange: () => void
  onToast: (kind: 'success' | 'error', message: string) => void
}

function formatLastSignIn(iso: string | null): string {
  if (!iso) return 'Pending first sign-in'
  const d = new Date(iso)
  const now = Date.now()
  const diffMin = Math.round((now - d.getTime()) / 60000)
  if (diffMin < 1) return 'Active now'
  if (diffMin < 60) return `${diffMin} min ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH} hour${diffH === 1 ? '' : 's'} ago`
  const diffD = Math.round(diffH / 24)
  if (diffD < 30) return `${diffD} day${diffD === 1 ? '' : 's'} ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatJoined(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function TeamMemberRow({
  member,
  isCurrentUser,
  activeSuperAdminCount,
  onChange,
  onToast,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const isSuperAdmin = member.role === 'super_admin'
  const isAdmin = member.role === 'admin'
  const isActive = member.deactivatedAt === null
  const isLastSuperAdmin = isSuperAdmin && isActive && activeSuperAdminCount === 1

  async function call(path: string, init: RequestInit, successMessage: string) {
    setBusy(true)
    setMenuOpen(false)
    try {
      const res = await fetch(path, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Request failed.')
      onToast('success', successMessage)
      onChange()
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Request failed.')
    } finally {
      setBusy(false)
    }
  }

  const sendRecovery = () =>
    call(
      `/api/admin/users/${member.id}/recover`,
      { method: 'POST' },
      `Password recovery email sent to ${member.email}.`,
    )

  const promote = () =>
    call(
      `/api/admin/users/${member.id}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'super_admin' }),
      },
      `${member.name || member.email} promoted to Super Admin.`,
    )

  const demote = () =>
    call(
      `/api/admin/users/${member.id}/role`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      },
      `${member.name || member.email} changed to Admin.`,
    )

  const deactivate = () =>
    call(
      `/api/admin/users/${member.id}/deactivate`,
      { method: 'POST' },
      `${member.name || member.email} deactivated.`,
    )

  const reactivate = () =>
    call(
      `/api/admin/users/${member.id}/reactivate`,
      { method: 'POST' },
      `${member.name || member.email} reactivated.`,
    )

  const status = isActive ? formatLastSignIn(member.lastSignInAt) : `Deactivated ${formatJoined(member.deactivatedAt!)}`
  const joined = `Joined ${formatJoined(member.createdAt)}`

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="font-semibold text-sm text-text-primary truncate">
            {member.name || '—'}
            {isCurrentUser && (
              <span className="ml-2 text-[10px] uppercase tracking-wider text-text-secondary/60 font-normal">
                you
              </span>
            )}
          </p>
          <span
            className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
              isSuperAdmin
                ? 'bg-accent/10 text-accent'
                : isAdmin
                ? 'bg-blue-500/10 text-blue-600'
                : 'bg-bg-card text-text-secondary'
            }`}
          >
            {isSuperAdmin ? 'Super Admin' : isAdmin ? 'Admin' : member.role}
          </span>
        </div>
        <p className="text-xs text-text-secondary mt-0.5 truncate">{member.email}</p>
        <p className="text-[11px] text-text-secondary/70 mt-1">
          {joined} · {status}
        </p>
      </div>

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          aria-label="Member actions"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-card disabled:opacity-40 transition-colors"
        >
          ⋯
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-border bg-bg-white shadow-xl py-1 text-sm">
            {isActive && (
              <>
                <button
                  onClick={sendRecovery}
                  className="w-full text-left px-3 py-2 hover:bg-bg-card transition-colors"
                >
                  Send password recovery
                </button>

                {isAdmin && (
                  <button
                    onClick={promote}
                    className="w-full text-left px-3 py-2 hover:bg-bg-card transition-colors"
                  >
                    Promote to Super Admin
                  </button>
                )}

                {isSuperAdmin && (
                  <button
                    onClick={demote}
                    disabled={isLastSuperAdmin}
                    title={isLastSuperAdmin ? 'Cannot demote the only active super-admin' : ''}
                    className="w-full text-left px-3 py-2 hover:bg-bg-card transition-colors disabled:text-text-secondary/40 disabled:cursor-not-allowed"
                  >
                    Change role to Admin
                  </button>
                )}

                <div className="my-1 border-t border-border" />

                <button
                  onClick={deactivate}
                  disabled={isLastSuperAdmin || isCurrentUser}
                  title={
                    isCurrentUser
                      ? 'You cannot deactivate yourself'
                      : isLastSuperAdmin
                      ? 'Cannot deactivate the only active super-admin'
                      : ''
                  }
                  className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-500/10 transition-colors disabled:text-text-secondary/40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  Deactivate
                </button>
              </>
            )}

            {!isActive && (
              <button
                onClick={reactivate}
                className="w-full text-left px-3 py-2 hover:bg-bg-card transition-colors"
              >
                Reactivate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
