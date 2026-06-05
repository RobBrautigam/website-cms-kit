'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30

function logLoginSuccess() {
  // Fire-and-forget. The endpoint requires a valid session, which is
  // already set at this point — that's what proves the login succeeded
  // and prevents anonymous callers from forging audit rows.
  // Failed-login attempts are recorded by Supabase's native
  // auth.audit_log_entries table; we don't post anything for failures.
  fetch('/api/admin/auth/log-success', { method: 'POST' }).catch(() => {})
}

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookieOptions: rememberMe
          ? { maxAge: THIRTY_DAYS_SECONDS }
          : { maxAge: undefined },
      }
    )

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      // Failures are recorded by Supabase's native auth.audit_log_entries
      // table. Do NOT make an authenticated network call here — there's no
      // session and the endpoint would (correctly) reject anonymous callers.
      setError(error.message)
      setLoading(false)
      return
    }

    if (data?.user) {
      logLoginSuccess()
    }

    // Check MFA enrollment
    let nextPath = '/admin/posts'
    try {
      const factorsRes = await fetch('/api/admin/mfa/list-factors')
      if (factorsRes.ok) {
        const factors = (await factorsRes.json()) as Array<{ status: string }>
        const hasTotp = factors.some((f) => f.status === 'verified')
        if (hasTotp) {
          nextPath = '/admin/login/verify'
        } else {
          const enforceRes = await fetch('/api/admin/mfa/enforcement-status')
          if (enforceRes.ok) {
            const enforce = (await enforceRes.json()) as { must_enforce: boolean }
            if (enforce.must_enforce) {
              nextPath = '/admin/security/enroll'
            }
          }
        }
      }
    } catch {
      // If MFA check fails (network), fall through to /admin/posts. The
      // /admin/security/enroll guard will catch hard-required users on next page load.
    }

    router.push(nextPath)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
      <div>
        <label htmlFor="email" className="block text-sm font-semibold text-text-secondary mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent transition"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-semibold text-text-secondary mb-1.5">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 pr-11 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent transition"
            placeholder="••••••••"
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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-border text-accent focus:ring-accent focus:ring-2 cursor-pointer"
          />
          Remember me for 30 days
        </label>
        <Link
          href="/admin/forgot-password"
          className="text-sm text-text-secondary hover:text-accent transition-colors whitespace-nowrap"
        >
          Forgot password?
        </Link>
      </div>

      {error && (
        <p className="text-red-500 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full btn-primary py-3 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  )
}
