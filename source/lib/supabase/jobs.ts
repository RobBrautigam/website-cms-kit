import type { SupabaseClient } from "@supabase/supabase-js";

export interface JobRow {
  id: string;
  slug: string;
  title: string;
  department: string;
  type: string;
  location: string;
  summary: string;
  responsibilities: string[];
  qualifications: string[];
  is_active: boolean;
  seo_title: string | null;
  seo_description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function fetchActiveJobs(client: SupabaseClient): Promise<JobRow[]> {
  const { data, error } = await client
    .from("job_openings")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JobRow[];
}

export async function fetchAllJobs(client: SupabaseClient): Promise<JobRow[]> {
  const { data, error } = await client
    .from("job_openings")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JobRow[];
}

export async function fetchJobBySlug(
  client: SupabaseClient,
  slug: string
): Promise<JobRow | null> {
  const { data, error } = await client
    .from("job_openings")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data as JobRow) ?? null;
}

export async function fetchJobById(
  client: SupabaseClient,
  id: string
): Promise<JobRow | null> {
  const { data, error } = await client
    .from("job_openings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as JobRow) ?? null;
}
