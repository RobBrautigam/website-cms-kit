import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { compilePattern, matchAndSubstitute } from "./patterns";
import type { UrlRedirect, PatternRedirect, RedirectMatch } from "./types";
import { RATE_LIMITS } from "../security/rate-limit";

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
 * Count one hit on a redirect, through `record_redirect_hit()` (migration
 * 002, section 15) on the service role. The function counts each visitor at
 * most RATE_LIMITS.redirectHit.perCaller times per window per redirect, and
 * each redirect at most perRedirect times per window in total, so a script
 * cannot inflate a counter by replaying the beacon or rotating addresses.
 * The public key can no longer bump the counter at all.
 *
 * Called from the proxy's `after()` for external redirects and from the
 * beacon route (/api/redirects/hit/[id]) for internal ones. Best-effort: a
 * missing service key or a failed call just skips the count.
 */
export async function recordHit(redirectId: string, callerKey: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const { perCaller, perRedirect, windowSeconds } = RATE_LIMITS.redirectHit;
  try {
    await fetch(`${url}/rest/v1/rpc/record_redirect_hit`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        redirect_id: redirectId,
        caller_key: callerKey,
        per_caller_max: perCaller,
        per_redirect_max: perRedirect,
        window_seconds: windowSeconds,
      }),
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
