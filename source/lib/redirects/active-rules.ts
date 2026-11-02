import type { createServerSupabaseClient } from "@/lib/supabase/server";
import type { RedirectRule } from "./chains";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Rows per read. Supabase's Data API returns at most 1,000 rows a request by default. */
export const RULES_PAGE = 1000;

/**
 * Every switched-on static redirect, read a page at a time so the API's row
 * cap never cuts the list short (a loop hidden past row 1,000 would pass the
 * check). Null when any page fails to read: callers fail closed.
 */
export async function readActiveStaticRules(supabase: ServerClient): Promise<RedirectRule[] | null> {
  const all: RedirectRule[] = [];
  for (let from = 0; ; from += RULES_PAGE) {
    const { data, error } = await supabase
      .from("url_redirects")
      .select("id, source, destination, enabled, is_pattern")
      .eq("enabled", true)
      .eq("is_pattern", false)
      .order("id", { ascending: true })
      .range(from, from + RULES_PAGE - 1);
    if (error || !data) return null;
    all.push(...(data as RedirectRule[]));
    if (data.length < RULES_PAGE) return all;
  }
}

/**
 * The site's own origin from NEXT_PUBLIC_SITE_URL, or null when it is unset or
 * not an address. A redirect to an absolute address on this origin is followed
 * like a path, so `/a -> https://www.example.com/b` cannot hide a loop.
 */
export function siteOrigin(raw: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string | null {
  if (!raw) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return null;
  }
}
