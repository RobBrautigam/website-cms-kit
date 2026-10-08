import { requireAdmin } from '@/lib/auth/require'
import { fetchTeamMembers } from '@/lib/auth/team-queries'
import { listStagedChanges } from '@/lib/staging/queries'
import { REVIEW_REQUIRED } from '@/lib/staging/rules'
import StagingView from './StagingView'

export const dynamic = 'force-dynamic'

export default async function StagingPage() {
  const { user } = await requireAdmin()
  const [changes, team] = await Promise.all([listStagedChanges(), fetchTeamMembers()])

  // Display names for the people named on staged changes, nothing more.
  const wanted = new Set(
    changes.flatMap((c) => [c.staged_by, c.review_requested_by, c.approved_by]).filter(Boolean) as string[]
  )
  const names: Record<string, string> = {}
  for (const m of team) if (wanted.has(m.id)) names[m.id] = m.name

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl font-black" style={{ fontFamily: 'var(--font-display)' }}>
          STAGING
        </h1>
        <form action="/api/admin/preview" method="post">
          <input type="hidden" name="path" value="/blog" />
          <button type="submit" className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-bg-card transition-colors">
            Open the staged site
          </button>
        </form>
      </div>
      <p className="text-sm text-text-secondary mb-8 max-w-2xl">
        Edits wait here, in a private copy, until someone publishes them. The public site keeps showing the live
        posts. Pick the changes to publish together, or ask a teammate to review one first.
      </p>
      <StagingView changes={changes} viewerId={user.id} names={names} reviewRequired={REVIEW_REQUIRED} />
    </>
  )
}
