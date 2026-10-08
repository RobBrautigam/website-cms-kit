'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useMemo, useTransition } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import RowDeleteButton from './RowDeleteButton'
import ToggleButton from './ToggleButton'
import { bulkPostAction, deletePost, togglePostStatus, duplicatePost } from '@/app/(admin)/admin/posts/actions'
import type { BulkAction } from '@/lib/admin/bulk'
import { reviewLabel, type ReviewStatus } from '@/lib/staging/rules'

// Keep in sync with the categories in PostMetaSidebar.
const CATEGORIES = ['product', 'engineering', 'company', 'guides', 'news']

interface PostRow {
  id: string
  title: string
  slug: string
  status: string
  published_at: string | null
  categories: string[]
  author_slug: string | null
  /** Review state of the post's staged copy, when it has one. */
  staged?: ReviewStatus
}

function StagedBadge({ status }: { status?: ReviewStatus }) {
  if (!status) return null
  return (
    <Link
      href="/admin/staging"
      className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent hover:underline"
      title="This post has changes waiting in staging. The live post is unchanged."
    >
      {status === 'staged' ? 'Staged' : `Staged: ${reviewLabel(status).toLowerCase()}`}
    </Link>
  )
}

export default function PostsTable({ posts }: { posts: PostRow[] }) {
  const router = useRouter()
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  // Bulk actions: the picked rows (only rows the filters show can be picked).
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const filteredPosts = useMemo(() => {
    return posts.filter((post) => {
      if (searchQuery && !post.title.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (statusFilter && post.status !== statusFilter) return false
      if (categoryFilter && !post.categories?.includes(categoryFilter)) return false
      return true
    })
  }, [posts, searchQuery, statusFilter, categoryFilter])

  const visiblePicked = filteredPosts.filter((p) => picked.has(p.id)).map((p) => p.id)
  const allPicked = filteredPosts.length > 0 && visiblePicked.length === filteredPosts.length

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePickAll() {
    setPicked(allPicked ? new Set() : new Set(filteredPosts.map((p) => p.id)))
  }

  async function runBulk(action: BulkAction) {
    if (visiblePicked.length === 0) return
    const n = visiblePicked.length
    if (action === 'delete' && !window.confirm(`Delete ${n} post${n === 1 ? '' : 's'}? This cannot be undone.`)) return
    setBulkBusy(true)
    const result = await bulkPostAction(action, visiblePicked)
    setBulkBusy(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    if (result.data!.skipped > 0) toast.warning(result.data!.summary)
    else toast.success(result.data!.summary)
    setPicked(new Set())
    router.refresh()
  }

  function handleDuplicate(post: PostRow) {
    setDuplicating(post.id)
    startTransition(async () => {
      const result = await duplicatePost(post.id)
      setDuplicating(null)
      if (result.ok && result.data) {
        toast.success(`Post duplicated: ${post.title}`)
        router.push(`/admin/posts/${result.data.newId}/edit`)
      } else if (!result.ok) {
        toast.error(result.error)
      }
    })
  }

  function statusBadgeClass(status: string) {
    switch (status) {
      case 'published': return 'bg-green-500/10 text-green-600'
      case 'scheduled': return 'bg-blue-500/10 text-blue-600'
      default: return 'bg-yellow-500/10 text-yellow-600'
    }
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-text-secondary mb-4">No blog posts yet.</p>
        <Link href="/admin/posts/new" className="text-accent font-semibold hover:underline">
          Create your first post
        </Link>
      </div>
    )
  }

  const filterControls = (
    <>
      <input
        type="text"
        placeholder="Search posts..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full md:flex-1 md:min-w-[200px] px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
      />
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="w-full md:w-auto px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
      >
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
        <option value="scheduled">Scheduled</option>
      </select>
      <select
        value={categoryFilter}
        onChange={(e) => setCategoryFilter(e.target.value)}
        className="w-full md:w-auto px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
        ))}
      </select>
    </>
  )

  return (
    <>
      {/* Mobile filter disclosure */}
      <details className="md:hidden mb-4 group">
        <summary className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-bg-card text-sm font-semibold text-text-primary cursor-pointer list-none">
          <Search size={16} strokeWidth={1.75} />
          <span className="flex-1 text-left">Search & filter</span>
          <ChevronDown size={16} strokeWidth={1.75} className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 space-y-3">{filterControls}</div>
      </details>

      {/* Desktop filter bar */}
      <div className="hidden md:flex flex-wrap gap-3 mb-4">{filterControls}</div>

      {(searchQuery || statusFilter || categoryFilter) && (
        <p className="text-xs text-text-secondary mb-3">
          Showing {filteredPosts.length} of {posts.length} posts
        </p>
      )}

      {/* Bulk actions: shown once a row is picked */}
      {visiblePicked.length > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-bg-white px-4 py-2.5 shadow-sm" role="region" aria-label="Bulk actions">
          <span className="text-sm font-semibold text-text-primary mr-2">{visiblePicked.length} selected</span>
          <button type="button" disabled={bulkBusy} onClick={() => void runBulk('publish')} className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50">Publish</button>
          <button type="button" disabled={bulkBusy} onClick={() => void runBulk('unpublish')} className="px-3 py-1.5 rounded-lg border border-border text-text-primary text-sm font-medium hover:bg-bg-card disabled:opacity-50">Unpublish</button>
          <button type="button" disabled={bulkBusy} onClick={() => void runBulk('delete')} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-50">Delete</button>
          <button type="button" disabled={bulkBusy} onClick={() => setPicked(new Set())} className="ml-auto text-sm text-text-secondary hover:underline">Clear</button>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-card border-b border-border">
              <th className="w-10 pl-5 py-3">
                <input type="checkbox" checked={allPicked} onChange={togglePickAll} aria-label="Select all shown posts" className="h-4 w-4 accent-[var(--accent)]" />
              </th>
              <th className="text-left text-xs font-semibold text-text-secondary uppercase tracking-wider px-5 py-3">Title</th>
              <th className="text-left text-xs font-semibold text-text-secondary uppercase tracking-wider px-5 py-3">Author</th>
              <th className="text-left text-xs font-semibold text-text-secondary uppercase tracking-wider px-5 py-3">Status</th>
              <th className="text-left text-xs font-semibold text-text-secondary uppercase tracking-wider px-5 py-3">Date</th>
              <th className="text-right text-xs font-semibold text-text-secondary uppercase tracking-wider px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredPosts.map((post) => (
              <tr key={post.id} className="border-b border-border last:border-0 hover:bg-bg-card/50 transition-colors">
                <td className="pl-5 py-4 align-top">
                  <input type="checkbox" checked={picked.has(post.id)} onChange={() => togglePick(post.id)} aria-label={`Select ${post.title}`} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                </td>
                <td className="px-5 py-4">
                  <Link href={`/admin/posts/${post.id}/edit`} className="font-semibold text-text-primary hover:text-accent transition-colors">
                    {post.title}
                  </Link>
                  <p className="text-xs text-text-secondary mt-0.5">/{post.slug}</p>
                  <StagedBadge status={post.staged} />
                </td>
                <td className="px-5 py-4 text-sm text-text-secondary whitespace-nowrap">
                  {post.author_slug || '—'}
                </td>
                <td className="px-5 py-4">
                  <ToggleButton
                    currentValue={post.status === 'published'}
                    onLabel="published"
                    offLabel={post.status === 'scheduled' ? 'scheduled' : 'draft'}
                    onClass={statusBadgeClass('published')}
                    offClass={statusBadgeClass(post.status === 'published' ? 'draft' : post.status)}
                    action={togglePostStatus.bind(null, post.id)}
                    onSuccessCopy="Post published"
                    offSuccessCopy="Post drafted"
                    className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                  />
                </td>
                <td className="px-5 py-4 text-sm text-text-secondary whitespace-nowrap">
                  {post.published_at
                    ? new Date(post.published_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })
                    : '—'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/admin/posts/${post.id}/edit`}
                      aria-label={`Edit ${post.title}`}
                      className="relative group p-2 rounded-lg text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" />
                      </svg>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] font-medium text-white bg-gray-900 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                        Edit
                      </span>
                    </Link>
                    <button
                      onClick={() => handleDuplicate(post)}
                      disabled={duplicating === post.id}
                      aria-label={`Duplicate ${post.title}`}
                      className="relative group p-2 rounded-lg text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="5" y="5" width="8" height="8" rx="1.5" />
                        <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
                      </svg>
                      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] font-medium text-white bg-gray-900 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                        {duplicating === post.id ? 'Duplicating...' : 'Duplicate'}
                      </span>
                    </button>
                    <RowDeleteButton
                      action={() => deletePost(post.id)}
                      itemLabel={post.title}
                      successCopy={`Post deleted: ${post.title}`}
                      className="relative group p-2 rounded-lg text-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
                      triggerLabel={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" />
                        </svg>
                      }
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <ul className="md:hidden space-y-3">
        {filteredPosts.map((post) => {
          const author = post.author_slug || '—'
          const date = post.published_at
            ? new Date(post.published_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })
            : '—'
          return (
            <li key={post.id} className="border border-border rounded-lg bg-bg-white p-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={picked.has(post.id)} onChange={() => togglePick(post.id)} aria-label={`Select ${post.title}`} className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]" />
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  className="block font-semibold text-text-primary hover:text-accent transition-colors"
                >
                  {post.title}
                </Link>
              </div>
              <p className="text-xs text-text-secondary mt-0.5">/{post.slug}</p>
                  <StagedBadge status={post.staged} />

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold">Author</p>
                  <p className="text-text-primary text-sm">{author}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold">Date</p>
                  <p className="text-text-primary text-sm">{date}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] uppercase tracking-wider text-text-secondary/70 font-semibold mb-1">Status</p>
                  <ToggleButton
                    currentValue={post.status === 'published'}
                    onLabel="published"
                    offLabel={post.status === 'scheduled' ? 'scheduled' : 'draft'}
                    onClass={statusBadgeClass('published')}
                    offClass={statusBadgeClass(post.status === 'published' ? 'draft' : post.status)}
                    action={togglePostStatus.bind(null, post.id)}
                    onSuccessCopy="Post published"
                    offSuccessCopy="Post drafted"
                    className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Link
                  href={`/admin/posts/${post.id}/edit`}
                  aria-label={`Edit ${post.title}`}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-primary hover:text-accent hover:bg-accent/10 transition-colors"
                >
                  Edit
                </Link>
                <button
                  onClick={() => handleDuplicate(post)}
                  disabled={duplicating === post.id}
                  aria-label={`Duplicate ${post.title}`}
                  className="flex items-center justify-center px-3 py-2 rounded-lg border border-border text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
                >
                  Duplicate
                </button>
                <RowDeleteButton
                  action={() => deletePost(post.id)}
                  itemLabel={post.title}
                  successCopy={`Post deleted: ${post.title}`}
                  className="flex items-center justify-center px-3 py-2 rounded-lg border border-border text-sm font-semibold text-text-secondary hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors"
                />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
