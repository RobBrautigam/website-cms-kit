/**
 * Redirect chains and loops. A chain (/a -> /b -> /c) costs every visitor and
 * crawler an extra round trip and loses link value at each hop; a loop
 * (/a -> /b -> /a) makes a page unreachable. The kit refuses a save or a
 * switch-on that would make a loop, and the Redirects screen lists every chain
 * with the one-hop fix. Only switched-on, static redirects are followed: a
 * pattern's destination depends on the request, so it is left to the tester.
 */

export type RedirectRule = {
  id?: string
  source: string
  destination: string
  enabled: boolean
  is_pattern: boolean
}

export const MAX_HOPS = 20

/**
 * The site path a destination names, in the same form as a stored source (no
 * query, no fragment, no trailing slash), or null for an address on another
 * site.
 */
export function destinationPath(destination: string): string | null {
  const d = (destination ?? '').trim()
  if (!d.startsWith('/') || d.startsWith('//')) return null
  const path = d.split(/[?#]/)[0]
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path
}

function activeMap(rules: RedirectRule[]): Map<string, RedirectRule> {
  const map = new Map<string, RedirectRule>()
  for (const r of rules) if (r.enabled && !r.is_pattern) map.set(r.source, r)
  return map
}

/** Where a visitor to `start` ends up: every address on the way, and whether it loops. */
export function follow(start: string, rules: RedirectRule[] | Map<string, RedirectRule>): { hops: string[]; loop: boolean } {
  const map = rules instanceof Map ? rules : activeMap(rules)
  const hops = [start]
  const seen = new Set([start])
  let at = start
  for (let i = 0; i < MAX_HOPS; i++) {
    const rule = map.get(at)
    if (!rule) return { hops, loop: false }
    const next = destinationPath(rule.destination)
    if (next === null) {
      hops.push(rule.destination)
      return { hops, loop: false }
    }
    hops.push(next)
    if (seen.has(next)) return { hops, loop: true }
    seen.add(next)
    at = next
  }
  return { hops, loop: true }
}

export type RedirectChain = { source: string; hops: string[]; fixTo: string }

/**
 * Every switched-on static redirect whose destination is itself redirected,
 * with the address it should point at directly. Loops are listed apart.
 */
export function findRedirectProblems(rules: RedirectRule[]): { chains: RedirectChain[]; loops: string[][] } {
  const map = activeMap(rules)
  const chains: RedirectChain[] = []
  const loops: string[][] = []
  const loopKeys = new Set<string>()
  for (const r of map.values()) {
    const { hops, loop } = follow(r.source, map)
    if (loop) {
      const cycle = hops.slice(hops.indexOf(hops[hops.length - 1]))
      const key = [...cycle.slice(0, -1)].sort().join(' ')
      if (!loopKeys.has(key)) {
        loopKeys.add(key)
        loops.push(cycle)
      }
      continue
    }
    if (hops.length > 2) chains.push({ source: r.source, hops, fixTo: hops[hops.length - 1] })
  }
  chains.sort((a, b) => a.source.localeCompare(b.source))
  return { chains, loops }
}

/**
 * Why saving (or switching on) `candidate` would make a loop, or null when it
 * would not. `existing` is every other redirect; a row with the candidate's
 * id or source is replaced by the candidate.
 */
export function loopRefusal(candidate: RedirectRule, existing: RedirectRule[]): string | null {
  if (!candidate.enabled || candidate.is_pattern) return null
  const target = destinationPath(candidate.destination)
  if (target === null) return null
  if (target === candidate.source) return `A redirect cannot point at its own address (${candidate.source}).`
  const others = existing.filter((r) => !(candidate.id && r.id === candidate.id) && r.source !== candidate.source)
  const { hops, loop } = follow(candidate.source, [...others, candidate])
  if (loop) return `This would make a loop: ${hops.join(' -> ')}. Point the redirect at the final page instead.`
  return null
}
