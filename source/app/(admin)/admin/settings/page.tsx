import { requireAdmin } from '@/lib/auth/require'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import SettingsView from './SettingsView'

export default async function SettingsPage() {
  const { user, role } = await requireAdmin()

  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.mfa.listFactors()
  const factors = data?.totp ?? []

  return (
    <SettingsView email={user.email || ''} role={role} factors={factors} />
  )
}
