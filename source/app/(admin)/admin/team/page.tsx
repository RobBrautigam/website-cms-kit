import { requireSuperAdmin } from '@/lib/auth/require'
import { fetchTeamMembers } from '@/lib/auth/team-queries'
import TeamPage from './TeamPage'

export const metadata = {
  title: 'Team | Acme Admin',
  robots: 'noindex, nofollow',
}

export default async function AdminTeamPage() {
  const { user } = await requireSuperAdmin()
  const members = await fetchTeamMembers()

  return <TeamPage members={members} currentUserId={user.id} />
}
