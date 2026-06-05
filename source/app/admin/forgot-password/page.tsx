import type { Metadata } from 'next'
import ForgotPasswordForm from './ForgotPasswordForm'
import AuthShell from '@/components/admin/AuthShell'

export const metadata: Metadata = {
  title: 'Forgot Password | Acme',
  robots: 'noindex, nofollow',
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      heading="Reset your password"
      subhead="Enter your email and we'll send you a one-time link to set a new one."
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
