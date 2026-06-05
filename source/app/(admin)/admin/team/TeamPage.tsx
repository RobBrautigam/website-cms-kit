'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { TeamMember } from '@/lib/auth/team-queries'
import InviteModal from './InviteModal'
import TeamMemberRow from './TeamMemberRow'

export default function TeamPage({
  members,
  currentUserId,
}: {
  members: TeamMember[]
  currentUserId: string
}) {
  const router = useRouter()
  // NOTE: members is read directly from the prop. router.refresh() re-runs
  // the server component which passes a new prop, and React re-renders
  // automatically. An earlier version stored members in useState and never
  // saw the new prop value — that swallowed every post-action refresh.
  const [showInvite, setShowInvite] = useState(false)
  const [isRefreshing, startTransition] = useTransition()
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const refresh = () => startTransition(() => router.refresh())

  const showToast = (kind: 'success' | 'error', message: string) => {
    setToast({ kind, message })
    setTimeout(() => setToast(null), 4000)
  }

  const { active, deactivated } = useMemo(() => {
    const a: TeamMember[] = []
    const d: TeamMember[] = []
    for (const m of members) {
      if (m.deactivatedAt) d.push(m)
      else a.push(m)
    }
    return { active: a, deactivated: d }
  }, [members])

  const activeSuperAdminCount = active.filter((m) => m.role === 'super_admin').length

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1
            className="text-2xl font-black tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            TEAM
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Invite, manage, and deactivate Acme admins.
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
        >
          <UserPlusIcon />
          Invite team member
        </button>
      </div>

      {/* Active members */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary/60">
            Active ({active.length})
          </h2>
          {isRefreshing && (
            <span className="text-[11px] text-text-secondary/60 inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              Updating
            </span>
          )}
        </div>
        <div className="border border-border rounded-xl divide-y divide-border">
          {active.map((m) => (
            <TeamMemberRow
              key={m.id}
              member={m}
              isCurrentUser={m.id === currentUserId}
              activeSuperAdminCount={activeSuperAdminCount}
              onChange={refresh}
              onToast={showToast}
            />
          ))}
          {active.length === 0 && (
            <div className="p-6 text-center text-sm text-text-secondary">
              No active team members. Invite someone to get started.
            </div>
          )}
        </div>
      </section>

      {/* Deactivated members */}
      {deactivated.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary/60 mb-3">
            Deactivated ({deactivated.length})
          </h2>
          <div className="border border-border rounded-xl divide-y divide-border opacity-70">
            {deactivated.map((m) => (
              <TeamMemberRow
                key={m.id}
                member={m}
                isCurrentUser={m.id === currentUserId}
                activeSuperAdminCount={activeSuperAdminCount}
                onChange={refresh}
                onToast={showToast}
              />
            ))}
          </div>
        </section>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onInvited={(email) => {
            setShowInvite(false)
            showToast('success', `Invite sent to ${email}.`)
            refresh()
          }}
          onError={(message) => showToast('error', message)}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-lg shadow-xl border text-sm ${
            toast.kind === 'success'
              ? 'bg-bg-white border-green-500/30 text-text-primary'
              : 'bg-bg-white border-red-500/30 text-red-600'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

function UserPlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </svg>
  )
}
