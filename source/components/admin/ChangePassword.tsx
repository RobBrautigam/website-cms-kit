'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
} from '@/lib/auth/password-strength'
import ModalShell from '@/components/admin/ModalShell'

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  const passwordCheck = checkPasswordStrength(password)
  const passwordTouched = password.length > 0
  const confirmMatches = passwordTouched && password === confirm
  const canSubmit = passwordCheck.ok && confirmMatches

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage('')

    if (!passwordCheck.ok) {
      setMessage(passwordCheck.reason || 'Password does not meet requirements.')
      return
    }
    if (password !== confirm) {
      setMessage('Passwords do not match.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setMessage('Failed: ' + error.message)
    } else {
      setSuccess(true)
      setMessage('Password updated.')
      setPassword('')
      setConfirm('')
      setTimeout(onClose, 1500)
    }
    setSaving(false)
  }

  return (
    <ModalShell
      onClose={onClose}
      ariaLabelledBy="change-password-title"
      panelClassName="bg-bg-white border border-border rounded-2xl p-6 w-full max-w-sm shadow-xl"
    >
        <h2
          id="change-password-title"
          className="font-black text-sm mb-4"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          CHANGE PASSWORD
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
            />
            <ul className="mt-2 space-y-1 text-[12px]">
              {passwordCheck.checks.map((c) => {
                const state = !passwordTouched ? 'idle' : c.met ? 'met' : 'unmet'
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-2 transition-colors ${
                      state === 'met'
                        ? 'text-green-600'
                        : state === 'unmet'
                        ? 'text-text-secondary'
                        : 'text-text-secondary/60'
                    }`}
                  >
                    {state === 'met' ? <CheckIcon /> : <CircleIcon />}
                    <span>{c.label}</span>
                  </li>
                )
              })}
            </ul>
          </div>

          <div>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className={`w-full px-3 py-2.5 rounded-lg border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition ${
                confirm && !confirmMatches
                  ? 'border-red-500/40'
                  : confirmMatches
                  ? 'border-green-500/40'
                  : 'border-border'
              }`}
            />
            {confirm && !confirmMatches && (
              <p className="mt-1.5 text-[11px] text-red-600">
                Passwords don&apos;t match yet.
              </p>
            )}
          </div>

          {message && (
            <p className={`text-sm ${success ? 'text-green-600' : 'text-red-500'}`}>
              {message}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-text-secondary text-sm font-medium hover:bg-bg-card transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !canSubmit}
              className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
    </ModalShell>
  )
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CircleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      className="shrink-0 opacity-50"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}
