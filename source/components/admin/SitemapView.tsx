'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'

export interface RouteGroup {
  title: string
  routes: { path: string; label: string; dynamic?: boolean }[]
}

interface TreeNode {
  segment: string
  path: string
  label?: string
  children: TreeNode[]
}

function buildTree(groups: RouteGroup[]): TreeNode {
  const root: TreeNode = { segment: '/', path: '/', label: 'Home', children: [] }

  const allRoutes = groups
    .filter((g) => g.title !== 'Admin Pages')
    .flatMap((g) => g.routes)

  for (const route of allRoutes) {
    if (route.path === '/') continue
    const segments = route.path.split('/').filter(Boolean)
    let current = root

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const fullPath = '/' + segments.slice(0, i + 1).join('/')
      let child = current.children.find((c) => c.segment === seg)
      if (!child) {
        child = { segment: seg, path: fullPath, children: [] }
        current.children.push(child)
      }
      if (i === segments.length - 1) {
        child.label = route.label
      }
      current = child
    }
  }

  return root
}

function buildAdminRoot(groups: RouteGroup[]): TreeNode | null {
  const adminGroup = groups.find((g) => g.title === 'Admin Pages')
  if (!adminGroup) return null

  return {
    segment: 'admin',
    path: '/admin',
    label: 'Admin',
    children: adminGroup.routes
      .filter((r) => r.path !== '/admin')
      .map((r) => {
        const segments = r.path.replace('/admin/', '').split('/')
        return {
          segment: segments[segments.length - 1],
          path: r.path,
          label: r.label,
          children: [],
        }
      }),
  }
}

function collectAllPaths(node: TreeNode): string[] {
  const paths = [node.path]
  for (const child of node.children) {
    paths.push(...collectAllPaths(child))
  }
  return paths
}

function collectPathsAtDepth(node: TreeNode, maxDepth: number, currentDepth = 0): string[] {
  if (currentDepth >= maxDepth) return []
  const paths = [node.path]
  for (const child of node.children) {
    paths.push(...collectPathsAtDepth(child, maxDepth, currentDepth + 1))
  }
  return paths
}

function countDescendants(node: TreeNode): number {
  let count = node.children.length
  for (const child of node.children) {
    count += countDescendants(child)
  }
  return count
}

function pruneTree(node: TreeNode, query: string): TreeNode | null {
  const q = query.toLowerCase()
  const labelMatch = node.label?.toLowerCase().includes(q) || false
  const pathMatch = node.path.toLowerCase().includes(q)

  const prunedChildren: TreeNode[] = []
  for (const child of node.children) {
    const pruned = pruneTree(child, query)
    if (pruned) prunedChildren.push(pruned)
  }

  if (labelMatch || pathMatch || prunedChildren.length > 0) {
    return { ...node, children: prunedChildren }
  }
  return null
}

// All sections share the same neutral chip style. Section identity comes from
// the section heading + path label, not chip hue — a single tonal variant
// reads cleaner than a per-section rainbow. Swap to your own brand tokens if
// you want color-coded sections.
const NEUTRAL_CHIP = {
  bg: 'bg-bg-card',
  border: 'border-border',
  text: 'text-text-secondary',
} as const

function getColor(_segment: string, _ancestors: string[]) {
  return NEUTRAL_CHIP
}

// --- Clickable path with copy ---

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 ${className || ''}`}>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`inline-block shrink-0 ${className || ''}`}>
      <polyline points="3 8 7 12 13 4" />
    </svg>
  )
}

function CopyablePath({ path, className }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      title="Click to copy path"
      className={`group/copy inline-flex items-center gap-1.5 cursor-pointer transition-colors ${copied ? 'text-green-500' : 'hover:text-accent'} ${className || ''}`}
    >
      <span>{copied ? 'Copied!' : path}</span>
      {copied
        ? <CheckIcon className="text-green-500" />
        : <CopyIcon className="opacity-0 group-hover/copy:opacity-70 transition-opacity" />
      }
    </button>
  )
}

// --- External link icon ---

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 1H1v10h10V7" />
      <path d="M7 1h4v4" />
      <path d="M11 1L5.5 6.5" />
    </svg>
  )
}

// --- Tree Branch ---

function TreeBranch({
  node,
  expandedPaths,
  togglePath,
  ancestors = [],
  isLast = false,
  depth = 0,
}: {
  node: TreeNode
  expandedPaths: Set<string>
  togglePath: (path: string) => void
  ancestors?: string[]
  isLast?: boolean
  depth?: number
}) {
  const hasChildren = node.children.length > 0
  const expanded = expandedPaths.has(node.path)
  const color = getColor(node.segment, ancestors)
  const childCount = countDescendants(node)

  return (
    <div className={depth > 0 ? 'relative' : ''}>
      {/* Connector line */}
      {depth > 0 && (
        <div className="absolute left-0 top-0 bottom-0 w-px bg-border" style={{ left: -16 }}>
          {isLast && <div className="absolute left-0 top-4 bottom-0 w-px bg-bg-white" />}
        </div>
      )}
      {depth > 0 && (
        <div className="absolute w-4 h-px bg-border" style={{ left: -16, top: 16 }} />
      )}

      {/* Node */}
      <div className="flex items-center gap-2 group">
        {hasChildren && (
          <button
            onClick={() => togglePath(node.path)}
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] bg-bg-card border border-border hover:border-accent/50 transition-colors shrink-0 cursor-pointer"
          >
            {expanded ? '−' : '+'}
          </button>
        )}
        {!hasChildren && <div className="w-5" />}

        <Link
          href={node.path}
          target="_blank"
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all hover:scale-[1.02] hover:shadow-sm ${color.bg} ${color.border} ${color.text}`}
        >
          <span className="whitespace-nowrap">{node.label || node.segment}</span>
          {hasChildren && (
            <span className={`text-[10px] ${expanded ? 'opacity-40' : 'opacity-60'}`}>
              {childCount}
            </span>
          )}
          <ExternalLinkIcon className="opacity-0 group-hover:opacity-60 transition-opacity" />
        </Link>

        <CopyablePath
          path={node.path}
          className="text-[10px] text-text-secondary/50 font-mono opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="ml-7 mt-1 space-y-1 relative">
          {node.children.map((child, i) => (
            <TreeBranch
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
              ancestors={[...ancestors, node.segment === '/' ? '' : node.segment].filter(Boolean)}
              isLast={i === node.children.length - 1}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Admin Tree ---

function AdminTree({
  adminRoot,
  expandedPaths,
  togglePath,
}: {
  adminRoot: TreeNode
  expandedPaths: Set<string>
  togglePath: (path: string) => void
}) {
  return (
    <div className="mt-6 pt-6 border-t border-border">
      <p className="text-[10px] uppercase tracking-widest text-text-secondary/60 mb-3 font-bold">Admin</p>
      <TreeBranch node={adminRoot} expandedPaths={expandedPaths} togglePath={togglePath} depth={0} />
    </div>
  )
}

// --- List View ---

function ListView({ groups, searchQuery }: { groups: RouteGroup[]; searchQuery: string }) {
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groups
    const q = searchQuery.toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        routes: group.routes.filter(
          (r) => r.label.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.routes.length > 0)
  }, [groups, searchQuery])

  if (filteredGroups.length === 0) {
    return (
      <div className="text-center py-16 text-text-secondary">
        <p className="text-sm">No pages match &ldquo;{searchQuery}&rdquo;</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {filteredGroups.map((group) => (
        <div key={group.title} className="border border-border rounded-xl overflow-hidden">
          <div className="bg-bg-card px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight">{group.title}</h2>
            <span className="text-[10px] text-text-secondary/60 font-mono">{group.routes.length} pages</span>
          </div>
          <div className="divide-y divide-border">
            {group.routes.map((route) => (
              <div key={route.path} className="flex items-center justify-between px-5 py-2.5 hover:bg-bg-card/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <CopyablePath
                    path={route.path}
                    className="text-xs text-text-secondary bg-bg-card px-2 py-0.5 rounded font-mono shrink-0"
                  />
                  <span className="text-sm text-text-primary truncate">{route.label}</span>
                </div>
                <Link
                  href={route.path}
                  target="_blank"
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors shrink-0 ml-3"
                >
                  Open
                  <ExternalLinkIcon />
                </Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// --- Visual View ---

function VisualView({ groups, searchQuery }: { groups: RouteGroup[]; searchQuery: string }) {
  const tree = useMemo(() => buildTree(groups), [groups])
  const adminRoot = useMemo(() => buildAdminRoot(groups), [groups])

  const displayTree = useMemo(() => {
    if (!searchQuery) return tree
    return pruneTree(tree, searchQuery) || { ...tree, children: [] }
  }, [tree, searchQuery])

  const displayAdminRoot = useMemo(() => {
    if (!searchQuery || !adminRoot) return adminRoot
    return pruneTree(adminRoot, searchQuery)
  }, [adminRoot, searchQuery])

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const paths = collectPathsAtDepth(tree, 2)
    if (adminRoot) paths.push(...collectPathsAtDepth(adminRoot, 2))
    return new Set(paths)
  })

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    const paths = collectAllPaths(displayTree)
    if (displayAdminRoot) paths.push(...collectAllPaths(displayAdminRoot))
    setExpandedPaths(new Set(paths))
  }, [displayTree, displayAdminRoot])

  const handleCollapseAll = useCallback(() => {
    // Keep root (Home) expanded so core pages stay visible
    setExpandedPaths(new Set([tree.path]))
  }, [tree.path])

  if (searchQuery && displayTree.children.length === 0 && !displayAdminRoot) {
    return (
      <div className="border border-border rounded-xl p-6 bg-bg-card/30 text-center py-16 text-text-secondary">
        <p className="text-sm">No pages match &ldquo;{searchQuery}&rdquo;</p>
      </div>
    )
  }

  return (
    <div className="border border-border rounded-xl p-6 bg-bg-card/30 overflow-x-auto">
      {/* Expand / Collapse toolbar */}
      <div className="flex items-center justify-end gap-1 mb-4">
        <button
          onClick={handleExpandAll}
          title="Expand all"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-lg border border-border hover:border-accent/50 bg-bg-card transition-colors cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 3 8 7 12 3" />
            <polyline points="4 9 8 13 12 9" />
          </svg>
          Expand All
        </button>
        <button
          onClick={handleCollapseAll}
          title="Collapse all"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-lg border border-border hover:border-accent/50 bg-bg-card transition-colors cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 7 8 3 12 7" />
            <polyline points="4 13 8 9 12 13" />
          </svg>
          Collapse All
        </button>
      </div>

      <div className="min-w-[400px]">
        {/* Root */}
        <div className="space-y-1">
          <TreeBranch node={displayTree} expandedPaths={expandedPaths} togglePath={togglePath} depth={0} />
        </div>

        {/* Admin section separate */}
        {displayAdminRoot && (
          <AdminTree adminRoot={displayAdminRoot} expandedPaths={expandedPaths} togglePath={togglePath} />
        )}
      </div>
    </div>
  )
}

// --- Main Component ---

export default function SitemapView({ groups, totalRoutes }: { groups: RouteGroup[]; totalRoutes: number }) {
  const [view, setView] = useState<'list' | 'visual'>('list')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredCount = useMemo(() => {
    if (!searchQuery) return totalRoutes
    const q = searchQuery.toLowerCase()
    return groups.reduce(
      (sum, g) => sum + g.routes.filter((r) => r.label.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)).length,
      0
    )
  }, [groups, searchQuery, totalRoutes])

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Sitemap
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {totalRoutes} pages across {groups.length} sections
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setView('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              view === 'list'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
            }`}
            title="List view"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
            </svg>
            List
          </button>
          <button
            onClick={() => setView('visual')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              view === 'visual'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
            }`}
            title="Visual tree view"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="3" r="2" />
              <circle cx="4" cy="13" r="2" />
              <circle cx="12" cy="13" r="2" />
              <line x1="8" y1="5" x2="4" y2="11" />
              <line x1="8" y1="5" x2="12" y2="11" />
            </svg>
            Tree
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search pages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm transition"
        />
        {searchQuery && (
          <p className="text-xs text-text-secondary mt-2">
            Showing {filteredCount} of {totalRoutes} pages
          </p>
        )}
      </div>

      {view === 'list' ? <ListView groups={groups} searchQuery={searchQuery} /> : <VisualView groups={groups} searchQuery={searchQuery} />}
    </div>
  )
}
