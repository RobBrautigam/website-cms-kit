'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { checkPasswordStrength, MIN_PASSWORD_LENGTH } from '@/lib/auth/password-strength'

type Status = 'checking' | 'ready' | 'invalid'

export default function ResetPasswordForm({
  context,
  exchangeError,
}: {
  context: 'invite' | 'recovery'
  exchangeError: string | null
}) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(exchangeError ? 'invalid' : 'checking')
  const [hashError, setHashError] = useState<string | null>(null)

  // Magic-link callback handling.
  //
  // Server already handled ?code=<pkce-code> via exchangeCodeForSession. If it
  // failed, exchangeError is set. If we're still loading, we need to handle
  // the OTHER flow: legacy implicit flow puts tokens in the URL HASH
  // (#access_token=...&refresh_token=...) which never reaches the server.
  //
  // Strategy:
  //   1. If exchangeError already set → render invalid state
  //   2. If a hash with access_token is present → setSession + strip hash
  //   3. Otherwise check for an existing session (server-side cookie set)
  //   4. If no session by the end → render invalid state with a path forward
  useEffect(() => {
    if (exchangeError) return
    let cancelled = false

    async function run() {
      const supabase = createClient()

      // Case 2: implicit-flow hash
      if (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) {
        const hash = new URLSearchParams(window.location.hash.slice(1))
        const access_token = hash.get('access_token')
        const refresh_token = hash.get('refresh_token')
        if (access_token && refresh_token) {
          const { error: setErr } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          })
          if (cancelled) return
          if (setErr) {
            setHashError(setErr.message)
            setStatus('invalid')
            return
          }
          // Strip the hash so a refresh / nav doesn't leak the tokens
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          )
          setStatus('ready')
          return
        }
      }

      // Case 3: existing session from server-side PKCE exchange
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) {
        setStatus('ready')
        return
      }

      // Case 4: no auth in any form — invalid landing
      setStatus('invalid')
    }

    run()
    return () => {
      cancelled = true
    }
  }, [exchangeError])

  // Always run the check so the checklist stays present (with empty state) on
  // first render. Submit is gated on `passwordCheck.ok && password === confirm`.
  const passwordCheck = checkPasswordStrength(password)
  const passwordTouched = password.length > 0
  const confirmMatches = passwordTouched && password === confirm
  const canSubmit = passwordCheck.ok && confirmMatches

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const check = checkPasswordStrength(password)
    if (!check.ok) {
      setError(check.reason || 'Password does not meet requirements.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    router.push('/admin/posts')
    router.refresh()
  }

  // Invalid: link expired / never had auth in either flow shape
  if (status === 'invalid') {
    const message = exchangeError || hashError || null
    return (
      <div className="space-y-5 text-left">
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-red-600 mb-2">
            This link is no longer valid.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed">
            Magic links expire after 1 hour and can only be used once.
            Request a new one to continue.
          </p>
          {message && (
            <p className="mt-3 text-[11px] text-text-secondary/60 font-mono break-all">
              {message}
            </p>
          )}
        </div>
        <Link
          href="/admin/forgot-password"
          className="w-full block text-center btn-primary py-3 text-sm font-bold"
        >
          Request a new link
        </Link>
        <Link
          href="/admin/login"
          className="block text-center text-sm text-text-secondary hover:text-accent transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  // Checking: brief loading state while we resolve the auth flow
  if (status === 'checking') {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 rounded-full border-2 border-border border-t-accent animate-spin" />
      </div>
    )
  }

  const submitLabel = context === 'invite' ? 'Set password and sign in' : 'Update password and sign in'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-semibold text-text-secondary mb-1.5"
        >
          New password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 pr-11 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent transition"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center justify-center w-11 text-text-secondary hover:text-text-primary transition"
          >
            {showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Live requirements checklist — replaces the strength meter. Each
          row turns green with a check icon as the requirement is met. */}
      <ul className="space-y-1.5 text-[12px]">
        {passwordCheck.checks.map((c) => {
          const state = !passwordTouched
            ? 'idle'
            : c.met
            ? 'met'
            : 'unmet'
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

      <div>
        <label
          htmlFor="confirm"
          className="block text-sm font-semibold text-text-secondary mb-1.5"
        >
          Confirm password
        </label>
        <input
          id="confirm"
          type={showPassword ? 'text' : 'password'}
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={`w-full px-4 py-3 rounded-lg border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent transition ${
            confirm && !confirmMatches
              ? 'border-red-500/40'
              : confirmMatches
              ? 'border-green-500/40'
              : 'border-border'
          }`}
          placeholder="Type it again"
        />
        {confirm && !confirmMatches && (
          <p className="mt-1.5 text-[11px] text-red-600">Passwords don&apos;t match yet.</p>
        )}
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !canSubmit}
        className="w-full btn-primary py-3 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Saving...' : submitLabel}
      </button>
    </form>
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
