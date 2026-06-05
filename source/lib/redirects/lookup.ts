import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { compilePattern, matchAndSubstitute } from "./patterns";
import type { UrlRedirect, PatternRedirect, RedirectMatch } from "./types";

const TTL_MS = 30_000;

interface CacheState {
  exact: Map<string, UrlRedirect>;
  patterns: PatternRedirect[];
  expires: number;
}

let cache: CacheState | null = null;
let inflight: Promise<CacheState> | null = null;
let injectedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (injectedClient) return injectedClient;
  // Anon client - RLS limits SELECT to enabled rows.
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

async function loadCache(): Promise<CacheState> {
  const client = getClient();
  const { data, error } = await client
    .from("url_redirects")
    .select("*")
    .eq("enabled", true);
  if (error) throw error;

  const exact = new Map<string, UrlRedirect>();
  const patterns: PatternRedirect[] = [];
  for (const row of (data ?? []) as UrlRedirect[]) {
    if (row.is_pattern) {
      patterns.push({ ...row, compiled: compilePattern(row.source) });
    } else {
      exact.set(row.source, row);
    }
  }
  return { exact, patterns, expires: Date.now() + TTL_MS };
}

async function ensureCache(): Promise<CacheState> {
  if (cache && cache.expires > Date.now()) return cache;
  if (inflight) return inflight;
  inflight = loadCache()
    .then((c) => {
      cache = c;
      inflight = null;
      return c;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

/**
 * Look up a redirect for the given pathname. Returns null on miss.
 *
 * Order of attempts:
 *   1. Exact match on `pathname`
 *   2. Exact match on `pathname` with trailing slash stripped
 *   3. Pattern matches in cache order
 *
 * Exact matches always win over pattern matches.
 */
export async function lookupRedirect(pathname: string): Promise<RedirectMatch | null> {
  const c = await ensureCache();

  let row: UrlRedirect | undefined = c.exact.get(pathname);
  if (!row && pathname.length > 1 && pathname.endsWith("/")) {
    row = c.exact.get(pathname.slice(0, -1));
  }
  if (row) {
    return { id: row.id, destination: row.destination, permanent: row.permanent };
  }

  for (const p of c.patterns) {
    const dest = matchAndSubstitute(pathname, p.compiled, p.destination);
    if (dest !== null) {
      return { id: p.id, destination: dest, permanent: p.permanent };
    }
  }
  return null;
}

/**
 * Hit counter increment via raw fetch to the Supabase RPC endpoint.
 *
 * NOT CURRENTLY CALLED FROM THE PROXY — see the Phase 1.5 follow-up. Two Next 16
 * constraints prevent the obvious wiring:
 *
 *   1. Pending I/O initiated AFTER a NextResponse.redirect() construction is
 *      short-circuited (verified in both Turbopack dev and `next start`).
 *      Even `await` before the return is not honored when the function will
 *      return a redirect.
 *   2. Module-level state in the proxy is NOT shared with route handlers
 *      (verified — they run in isolated module instances), so a "queue in
 *      proxy / flush in route handler" pattern cannot bridge them.
 *
 * The function is exported and ready for a follow-up phase, which will use one of:
 *   - Client-side beacon fetch from internal destination pages.
 *   - A separate edge-side solution for external destinations.
 *   - A waitUntil binding once Next.js exposes one for proxy middleware.
 */
export async function recordHit(redirectId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/rpc/increment_redirect_hit`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ redirect_id: redirectId }),
    });
  } catch {
    // Swallow - hit_count is best-effort.
  }
}

// Test helpers (exported with underscore prefix to mark internal use)
export function _resetLookupForTests() {
  cache = null;
  inflight = null;
  injectedClient = null;
}
export function _setSupabaseClientForTests(client: SupabaseClient) {
  injectedClient = client;
  cache = null;
  inflight = null;
}
