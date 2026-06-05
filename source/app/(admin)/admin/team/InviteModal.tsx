'use client'

import { useState } from 'react'
import ModalShell from '@/components/admin/ModalShell'

export default function InviteModal({
  onClose,
  onInvited,
  onError,
}: {
  onClose: () => void
  onInvited: (email: string) => void
  onError: (message: string) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'admin' | 'super_admin'>('admin')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send invite.')
      }
      onInvited(email)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send invite.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} ariaLabelledBy="invite-modal-title">
        <h2
          id="invite-modal-title"
          className="font-black text-sm mb-1"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          INVITE TEAM MEMBER
        </h2>
        <p className="text-xs text-text-secondary mb-5">
          They&apos;ll get a one-time magic link to set their own password.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
              placeholder="person@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-text-secondary mb-1.5">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'super_admin')}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
            >
              <option value="admin">Admin — manage all CMS content</option>
              <option value="super_admin">Super Admin — also manage team and roles</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-bg-card transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Send invite'}
            </button>
          </div>
        </form>
    </ModalShell>
  )
}
