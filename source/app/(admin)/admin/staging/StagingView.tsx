'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import ConfirmDialog from '@/components/admin/ConfirmDialog'
import TipTapRenderer from '@/components/TipTapRenderer'
import type { ActionResult } from '@/lib/admin/action-result'
import type { StagedChangeWithPost } from '@/lib/staging/queries'
import { availableActions, checkPublishSelection, reviewLabel, type ReviewStatus } from '@/lib/staging/rules'
import { approveStaged, discardStaged, publishStaged, requestReview, withdrawReview } from './actions'

interface Props {
  changes: StagedChangeWithPost[]
  viewerId: string
  names: Record<string, string>
  reviewRequired: boolean
}

const COMPARED_FIELDS = [
  ['title', 'Title'],
  ['slug', 'Slug'],
  ['excerpt', 'Excerpt'],
  ['meta_description', 'Search description'],
  ['categories', 'Categories'],
  ['featured_image_url', 'Featured image'],
  ['author_slug', 'Author'],
  ['body', 'Body'],
] as const

function badgeClass(status: ReviewStatus) {
  switch (status) {
    case 'approved': return 'bg-green-500/10 text-green-600'
    case 'in_review': return 'bg-blue-500/10 text-blue-600'
    default: return 'bg-yellow-500/10 text-yellow-600'
  }
}

function changedFields(c: StagedChangeWithPost): string[] {
  if (!c.post || c.post.status !== 'published') return ['New post']
  const live = c.post as unknown as Record<string, unknown>
  const staged = c as unknown as Record<string, unknown>
  return COMPARED_FIELDS.filter(([key]) => JSON.stringify(live[key] ?? null) !== JSON.stringify(staged[key] ?? null)).map(([, label]) => label)
}

export default function StagingView({ changes, viewerId, names, reviewRequired }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [compareId, setCompareId] = useState<string | null>(changes[0]?.id ?? null)
  const [confirm, setConfirm] = useState<null | { kind: 'publish' } | { kind: 'discard'; id: string; title: string }>(null)

  const who = (id: string | null) => (!id ? 'someone' : id === viewerId ? 'you' : names[id] ?? 'a teammate')
  const compared = changes.find((c) => c.id === compareId) ?? null
  const pickedChanges = useMemo(() => changes.filter((c) => picked.has(c.id)), [changes, picked])

  function run(fn: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await fn()
      setConfirm(null)
      if (result.ok) {
        toast.success(success)
        setPicked(new Set())
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function askPublish() {
    const check = checkPublishSelection(
      pickedChanges.map((c) => ({ id: c.id, reviewStatus: c.review_status, stagedBy: c.staged_by, title: c.title })),
      { reviewRequired }
    )
    if (!check.ok) { toast.error(check.message); return }
    setConfirm({ kind: 'publish' })
  }

  if (changes.length === 0) {
    return (
      <div className="text-center py-20 border border-dashed border-border rounded-lg">
        <p className="text-text-secondary mb-2">Nothing is staged.</p>
        <p className="text-sm text-text-secondary">
          Open a post and choose <strong>Stage changes</strong> to save an edit here without changing the live site.
        </p>
        <Link href="/admin/posts" className="inline-block mt-4 text-accent font-semibold hover:underline">Go to posts</Link>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-text-secondary" aria-live="polite">
          {changes.length} staged {changes.length === 1 ? 'change' : 'changes'}, {picked.size} picked
        </p>
        <button
          type="button"
          onClick={askPublish}
          disabled={pending || picked.size === 0}
          className="btn-primary px-5 py-2 text-sm font-bold disabled:opacity-50"
        >
          Publish selected{picked.size ? ` (${picked.size})` : ''}
        </button>
      </div>

      <ul className="space-y-3">
        {changes.map((c) => {
          const a = availableActions({ reviewStatus: c.review_status, stagedBy: c.staged_by }, viewerId, { reviewRequired })
          const isNew = !c.post || c.post.status !== 'published'
          const ownChange = c.review_status === 'in_review' && c.staged_by === viewerId
          return (
            <li key={c.id} className={`border rounded-lg bg-bg-white p-4 ${compareId === c.id ? 'border-accent' : 'border-border'}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={picked.has(c.id)}
                  disabled={!a.publish || pending}
                  onChange={() => togglePick(c.id)}
                  aria-label={`Pick "${c.title}" to publish`}
                  title={a.publish ? undefined : 'Needs an approval before it can be published'}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.title}</span>
                    {isNew && <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-accent/10 text-accent">New</span>}
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${badgeClass(c.review_status)}`}>
                      {reviewLabel(c.review_status)}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary mt-1">
                    Staged by {who(c.staged_by)}
                    {c.review_status === 'in_review' && <> &middot; review asked by {who(c.review_requested_by)}</>}
                    {c.review_status === 'approved' && <> &middot; approved by {who(c.approved_by)}</>}
                    {' '}&middot; changed: {changedFields(c).join(', ') || 'nothing yet'}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={() => setCompareId(c.id)} className="px-3 py-1.5 rounded border border-border text-xs font-medium hover:bg-bg-card">
                      Compare
                    </button>
                    <Link href={`/admin/posts/${c.post_id}/edit`} className="px-3 py-1.5 rounded border border-border text-xs font-medium hover:bg-bg-card">
                      Edit
                    </Link>
                    {a.requestReview && (
                      <button type="button" disabled={pending} onClick={() => run(() => requestReview(c.id), 'Review requested')} className="px-3 py-1.5 rounded border border-border text-xs font-medium hover:bg-bg-card disabled:opacity-50">
                        Request review
                      </button>
                    )}
                    {c.review_status === 'in_review' && (
                      <button
                        type="button"
                        disabled={pending || !a.approve}
                        onClick={() => run(() => approveStaged(c.id), 'Approved')}
                        title={ownChange ? 'You staged this change. A teammate approves it.' : undefined}
                        className="px-3 py-1.5 rounded border border-green-600 text-green-600 text-xs font-bold hover:bg-green-500/10 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    )}
                    {a.withdraw && (
                      <button type="button" disabled={pending} onClick={() => run(() => withdrawReview(c.id), 'Moved back to staged')} className="px-3 py-1.5 rounded border border-border text-xs font-medium hover:bg-bg-card disabled:opacity-50">
                        {c.review_status === 'approved' ? 'Take back approval' : 'Withdraw request'}
                      </button>
                    )}
                    <button type="button" disabled={pending} onClick={() => setConfirm({ kind: 'discard', id: c.id, title: c.title })} className="px-3 py-1.5 rounded border border-red-500/40 text-red-600 text-xs font-medium hover:bg-red-500/10 disabled:opacity-50">
                      Discard
                    </button>
                  </div>
                  {ownChange && (
                    <p className="text-xs text-text-secondary mt-2">You staged this change, so a teammate approves it.</p>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {compared && (
        <section aria-label="Live and staged side by side" className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-3">Live and staged, side by side</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <article className="border border-border rounded-lg p-4 bg-bg-white">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-2">Live now</p>
              {compared.post && compared.post.status === 'published' ? (
                <>
                  <h3 className="text-lg font-bold">{compared.post.title}</h3>
                  <p className="text-xs text-text-secondary mb-3">/blog/{compared.post.slug}</p>
                  {compared.post.excerpt && <p className="text-sm mb-3">{compared.post.excerpt}</p>}
                  <TipTapRenderer value={compared.post.body} />
                </>
              ) : (
                <p className="text-sm text-text-secondary">Not on the site yet. Publishing makes this a new post.</p>
              )}
            </article>
            <article className="border border-accent rounded-lg p-4 bg-bg-white">
              <p className="text-[11px] font-bold uppercase tracking-wide text-accent mb-2">Staged</p>
              <h3 className="text-lg font-bold">{compared.title}</h3>
              <p className="text-xs text-text-secondary mb-3">/blog/{compared.slug}</p>
              {compared.excerpt && <p className="text-sm mb-3">{compared.excerpt}</p>}
              <TipTapRenderer value={compared.body} />
            </article>
          </div>
        </section>
      )}

      {confirm?.kind === 'publish' && (
        <ConfirmDialog
          title={`Publish ${picked.size} ${picked.size === 1 ? 'change' : 'changes'}?`}
          description={`${pickedChanges.map((c) => `"${c.title}"`).join(', ')} will replace the live versions on the public site. All of them go live together, or none do.`}
          confirmLabel="Publish"
          confirmTone="primary"
          pending={pending}
          onConfirm={() => run(() => publishStaged(Array.from(picked)), 'Published')}
          onClose={() => { if (!pending) setConfirm(null) }}
        />
      )}
      {confirm?.kind === 'discard' && (
        <ConfirmDialog
          title="Discard this staged change?"
          description={`The staged copy of "${confirm.title}" is deleted. The live post stays exactly as it is.`}
          confirmLabel="Discard"
          confirmTone="danger"
          pending={pending}
          onConfirm={() => run(() => discardStaged(confirm.id), 'Staged change discarded')}
          onClose={() => { if (!pending) setConfirm(null) }}
        />
      )}
    </>
  )
}
