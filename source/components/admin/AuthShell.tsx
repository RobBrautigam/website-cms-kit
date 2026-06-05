import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'
import { APP_VERSION } from '@/lib/version'

/**
 * Shared shell for the admin auth pages: /admin/login,
 * /admin/forgot-password, /admin/reset-password.
 *
 * Centered layout (Linear/Notion onboarding pattern), logo + wordmark on
 * top, the form in a soft card, and a small footer with a link back to the
 * marketing site and the app version pin.
 */
export default function AuthShell({
  heading,
  subhead,
  children,
}: {
  heading: string
  subhead?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-12 bg-gradient-to-b from-bg-white via-bg-white to-bg-card">
      <div className="w-full max-w-sm">
        {/* Logo + wordmark */}
        <div className="flex flex-col items-center mb-8">
          <Link href="/" aria-label="Acme" className="group inline-flex">
            <LogoMark
              size={56}
              className="text-accent transition-transform duration-300 group-hover:scale-[1.04]"
            />
          </Link>
          <p
            className="mt-5 text-[11px] font-bold tracking-[0.22em] text-text-secondary/80 uppercase"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Acme
          </p>
          <h1
            className="mt-3 text-2xl font-black tracking-tight text-text-primary text-center"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {heading}
          </h1>
          {subhead && (
            <p className="mt-2 text-sm text-text-secondary text-center max-w-xs">
              {subhead}
            </p>
          )}
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-border bg-bg-white p-7 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.06)]">
          {children}
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-between text-[11px] text-text-secondary/50">
          <Link href="/" className="hover:text-accent transition-colors">
            ← example.com
          </Link>
          <span className="font-mono">{APP_VERSION}</span>
        </div>
      </div>
    </div>
  )
}
