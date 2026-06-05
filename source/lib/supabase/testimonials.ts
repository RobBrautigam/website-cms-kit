import type { SupabaseClient } from "@supabase/supabase-js";

export type TestimonialKind = "text" | "video";

export interface Testimonial {
  id: string;

  /** Optional id from an external collection tool (e.g. an import source). */
  external_id: string | null;
  source: string;

  kind: TestimonialKind;
  name: string;
  tagline: string | null;
  company: string | null;
  headshot_url: string | null;
  screenshot_url: string | null;
  quote: string;
  headline: string | null;
  rating: number | null;
  external_url: string | null;
  email: string | null;
  website_url: string | null;
  linkedin_url: string | null;

  video_url: string | null;
  video_thumbnail_url: string | null;
  video_transcript: string | null;
  video_duration_sec: number | null;
  video_aspect_ratio: string | null;

  is_visible: boolean;
  display_order: number;

  received_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchVisibleTestimonials(
  client: SupabaseClient
): Promise<Testimonial[]> {
  const { data, error } = await client
    .from("testimonials")
    .select("*")
    .eq("is_visible", true)
    .order("display_order", { ascending: true })
    .order("received_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Testimonial[];
}

export async function fetchAllTestimonials(
  client: SupabaseClient
): Promise<Testimonial[]> {
  const { data, error } = await client
    .from("testimonials")
    .select("*")
    .order("display_order", { ascending: true })
    .order("received_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Testimonial[];
}

export async function fetchTestimonialById(
  client: SupabaseClient,
  id: string
): Promise<Testimonial | null> {
  const { data, error } = await client
    .from("testimonials")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Testimonial) ?? null;
}

const ALLOWED_TAGS = new Set(["strong", "em", "mark", "br"]);
const TAG_NORMALIZE: Record<string, string> = { b: "strong", i: "em" };
const DANGEROUS_TAGS = ["script", "style", "iframe", "object", "embed", "noscript"];

export function sanitizeQuote(input: string): string {
  if (!input) return "";

  // 1. Strip dangerous tags AND their content entirely (not just the tags).
  let s = input;
  for (const tag of DANGEROUS_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    s = s.replace(re, "");
    // Also strip self-closing or unclosed instances.
    s = s.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }

  // 2. Normalize <b>/<i> to <strong>/<em>.
  s = s.replace(/<\/?(b|i)(\s[^>]*)?>/gi, (full, tag) => {
    const norm = TAG_NORMALIZE[tag.toLowerCase()];
    const isClose = full.startsWith("</");
    return isClose ? `</${norm}>` : `<${norm}>`;
  });

  // 3. For remaining tags: keep allowed (without attributes), strip disallowed (preserve inner text).
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\/?>/g, (full, tagName) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return "";
    const isClose = full.startsWith("</");
    if (lower === "br") return "<br>";
    return isClose ? `</${lower}>` : `<${lower}>`;
  });

  return s.replace(/\s{2,}/g, " ").trim();
}

export interface CreatePublicTestimonialInput {
  kind: TestimonialKind;
  name: string;
  quote?: string;
  videoUrl?: string;
  videoThumbnailUrl?: string | null;
  screenshotUrl?: string | null;
}

export interface CreatePublicTestimonialResult {
  id: string;
  firstName: string;
}

export function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export async function createPublicTestimonial(
  client: SupabaseClient,
  input: CreatePublicTestimonialInput,
): Promise<CreatePublicTestimonialResult> {
  const isVideo = input.kind === "video";
  const payload = {
    kind: input.kind,
    name: input.name.trim(),
    quote: isVideo ? "[Video testimonial]" : sanitizeQuote(input.quote ?? ""),
    source: "public-form",
    is_visible: false,
    display_order: 0,
    video_url: isVideo ? (input.videoUrl ?? null) : null,
    video_thumbnail_url: isVideo ? (input.videoThumbnailUrl ?? null) : null,
    screenshot_url: !isVideo ? (input.screenshotUrl ?? null) : null,
    received_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from("testimonials")
    .insert(payload)
    .select("id, name")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert testimonial");
  }

  return {
    id: data.id as string,
    firstName: extractFirstName(data.name as string),
  };
}

export interface EnrichPublicTestimonialInput {
  tagline: string | null;
  company: string | null;
  email: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  rating: number | null;
  headshotUrl: string | null;
}

export async function enrichPublicTestimonial(
  client: SupabaseClient,
  id: string,
  input: EnrichPublicTestimonialInput,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.tagline !== null) payload.tagline = input.tagline;
  if (input.company !== null) payload.company = input.company;
  if (input.email !== null) payload.email = input.email;
  if (input.websiteUrl !== null) payload.website_url = input.websiteUrl;
  if (input.linkedinUrl !== null) payload.linkedin_url = input.linkedinUrl;
  if (input.headshotUrl !== null) payload.headshot_url = input.headshotUrl;
  if (input.rating !== null) payload.rating = input.rating;

  // No early-return on empty payload: we still call update() so callers can
  // detect invalid IDs / RLS denials. The empty-payload UPDATE is a harmless
  // no-op in PostgREST (returns 204, zero rows affected).
  const { error } = await client.from("testimonials").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}
