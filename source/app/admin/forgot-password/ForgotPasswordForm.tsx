'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Status = 'idle' | 'submitting' | 'success' | 'rate_limited' | 'error'

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMessage(null)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/reset-password?context=recovery`,
    })

    // We surface real errors here. This admin is invite-only — no public
    // signup — so the conventional anti-enumeration ("always show success")
    // would just hide useful feedback like rate limits without giving us any
    // security benefit. Linear/Stripe internal-team flows do the same.
    if (error) {
      const message = error.message || ''
      const code = (error as { code?: string }).code

      if (
        code === 'over_email_send_rate_limit' ||
        message.toLowerCase().includes('rate limit')
      ) {
        setStatus('rate_limited')
      } else {
        setStatus('error')
        setErrorMessage(message || 'Could not send the reset link.')
      }
      return
    }

    setStatus('success')
  }

  if (status === 'success') {
    return (
      <div className="space-y-5 text-left">
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-5 text-center">
          <p className="text-sm text-text-primary font-medium mb-2">
            Reset link sent.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed">
            We sent a password reset link to{' '}
            <span className="font-medium text-text-primary">{email}</span>. The link
            expires in 1 hour. Check your spam folder if it doesn&apos;t arrive within
            a minute.
          </p>
        </div>
        <Link
          href="/admin/login"
          className="block text-center text-sm text-text-secondary hover:text-accent transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  if (status === 'rate_limited') {
    return (
      <div className="space-y-5 text-left">
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-5 text-center">
          <p className="text-sm font-medium text-text-primary mb-2">
            Too many requests.
          </p>
          <p className="text-xs text-text-secondary leading-relaxed">
            We can only send one email per minute to the same address.
            Please wait about a minute and try again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="w-full btn-primary py-3 text-sm font-bold"
        >
          Try again
        </button>
        <Link
          href="/admin/login"
          className="block text-center text-sm text-text-secondary hover:text-accent transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-semibold text-text-secondary mb-1.5"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent transition"
          placeholder="you@example.com"
        />
      </div>

      {status === 'error' && errorMessage && (
        <p className="text-red-500 text-sm">{errorMessage}</p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting' || !email}
        className="w-full btn-primary py-3 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'submitting' ? 'Sending...' : 'Send reset link'}
      </button>

      <Link
        href="/admin/login"
        className="block text-center text-sm text-text-secondary hover:text-accent transition-colors"
      >
        Back to sign in
      </Link>
    </form>
  )
}
