'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Route-group error boundary for /admin/*. Catches anything thrown by a child
 * server component or server action and renders a themed recovery screen
 * instead of Next's default crash page. Gives the user a clear way back to
 * /admin/posts and a "Try again" affordance via the Next.js `reset()` callback.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[admin/error]', error)
  }, [error])

  return (
    <div className="max-w-xl mx-auto py-16 text-center">
      <h1
        className="text-2xl font-black uppercase tracking-tight text-text-primary mb-3"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Something went wrong
      </h1>
      <p className="text-sm text-text-secondary mb-2">
        The admin surface hit an unexpected error. Try the action again, or
        head back to the posts list. If it keeps happening, contact your
        administrator.
      </p>
      {error.digest && (
        <p className="text-xs text-text-secondary/70 font-mono mb-6">
          Error ref: {error.digest}
        </p>
      )}
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="btn-primary px-5 py-2.5 text-sm font-bold"
        >
          Try again
        </button>
        <Link
          href="/admin/posts"
          className="px-5 py-2.5 text-sm font-bold rounded-lg border border-border text-text-primary hover:bg-bg-card transition-colors"
        >
          Back to Posts
        </Link>
      </div>
    </div>
  )
}
