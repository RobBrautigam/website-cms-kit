import type { Metadata } from 'next'
import LoginForm from '@/components/admin/LoginForm'
import AuthShell from '@/components/admin/AuthShell'

export const metadata: Metadata = {
  title: 'Sign In | Acme',
  robots: 'noindex, nofollow',
}

export default function AdminLoginPage() {
  return (
    <AuthShell heading="Welcome back" subhead="Sign in to the Acme admin.">
      <LoginForm />
    </AuthShell>
  )
}
