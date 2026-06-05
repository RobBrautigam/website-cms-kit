import type { SupabaseClient } from "@supabase/supabase-js";
import type { UrlRedirect } from "./types";

export type SortKey = "last_hit" | "alphabetical" | "newest" | "most_hits";

export interface FetchAllOptions {
  search?: string;
  category?: string | null; // null = uncategorized only
  sort?: SortKey;
  page?: number;     // 1-based
  pageSize?: number;
}

export interface FetchAllResult {
  rows: UrlRedirect[];
  totalCount: number;
}

export async function fetchAllRedirects(
  client: SupabaseClient,
  opts: FetchAllOptions = {}
): Promise<FetchAllResult> {
  const { search, category, sort = "last_hit", page = 1, pageSize = 50 } = opts;
  let q = client.from("url_redirects").select("*", { count: "exact" });

  if (search) {
    const pattern = `%${search}%`;
    q = q.or(
      `source.ilike.${pattern},destination.ilike.${pattern},notes.ilike.${pattern},category.ilike.${pattern}`
    );
  }

  if (category === null) {
    q = q.is("category", null);
  } else if (category) {
    q = q.eq("category", category);
  }

  switch (sort) {
    case "alphabetical":
      q = q.order("source", { ascending: true });
      break;
    case "newest":
      q = q.order("created_at", { ascending: false });
      break;
    case "most_hits":
      q = q.order("hit_count", { ascending: false }).order("source", { ascending: true });
      break;
    case "last_hit":
    default:
      q = q
        .order("last_access", { ascending: false, nullsFirst: false })
        .order("source", { ascending: true });
      break;
  }

  const from = (page - 1) * pageSize;
  q = q.range(from, from + pageSize - 1);

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as UrlRedirect[], totalCount: count ?? 0 };
}

export async function fetchRedirectById(
  client: SupabaseClient,
  id: string
): Promise<UrlRedirect | null> {
  const { data, error } = await client
    .from("url_redirects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as UrlRedirect | null) ?? null;
}

export async function fetchDistinctCategories(
  client: SupabaseClient
): Promise<string[]> {
  const { data, error } = await client
    .from("url_redirects")
    .select("category")
    .not("category", "is", null);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of (data ?? []) as { category: string | null }[]) {
    if (row.category) set.add(row.category);
  }
  return [...set].sort();
}
