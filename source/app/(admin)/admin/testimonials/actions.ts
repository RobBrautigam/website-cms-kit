"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { recordAdminAction } from "@/lib/auth/audit";
import { sanitizeQuote } from "@/lib/supabase/testimonials";
import {
  ok,
  err,
  type ActionResult,
  wrapSupabaseError,
} from "@/lib/admin/action-result";

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function parseInt0(value: FormDataEntryValue | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseIntOrNull(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseFloatOrNull(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseFormData(formData: FormData) {
  const kind = String(formData.get("kind") ?? "text");
  const isVideo = kind === "video";
  return {
    kind,
    name: String(formData.get("name") ?? "").trim(),
    tagline: emptyToNull(formData.get("tagline")),
    company: emptyToNull(formData.get("company")),
    headshot_url: emptyToNull(formData.get("headshot_url")),
    screenshot_url: emptyToNull(formData.get("screenshot_url")),
    quote: sanitizeQuote(String(formData.get("quote") ?? "").trim()),
    headline: emptyToNull(formData.get("headline")),
    rating: parseIntOrNull(formData.get("rating")),
    source: String(formData.get("source") ?? "manual").trim() || "manual",
    external_url: emptyToNull(formData.get("external_url")),
    email: emptyToNull(formData.get("email")),
    website_url: emptyToNull(formData.get("website_url")),
    linkedin_url: emptyToNull(formData.get("linkedin_url")),
    video_url: isVideo ? emptyToNull(formData.get("video_url")) : null,
    video_thumbnail_url: isVideo ? emptyToNull(formData.get("video_thumbnail_url")) : null,
    video_transcript: isVideo ? emptyToNull(formData.get("video_transcript")) : null,
    video_duration_sec: isVideo ? parseFloatOrNull(formData.get("video_duration_sec")) : null,
    video_aspect_ratio: isVideo ? emptyToNull(formData.get("video_aspect_ratio")) : null,
    is_visible: formData.get("is_visible") === "on",
    display_order: parseInt0(formData.get("display_order")),
    received_at: emptyToNull(formData.get("received_at")),
  };
}

export async function createTestimonial(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const payload = parseFormData(formData);
  const { data: inserted, error } = await supabase
    .from("testimonials")
    .insert(payload)
    .select("id, name, is_visible")
    .single();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!inserted) return err("Insert succeeded but returned no row.", "server");
  await recordAdminAction({
    action: "testimonial.create",
    resource_type: "testimonial",
    resource_id: inserted.id as string,
    payload: {
      name: inserted.name,
      is_visible: inserted.is_visible,
    },
  });
  revalidatePath("/admin/testimonials");
  revalidatePath("/results");
  return ok();
}

export async function updateTestimonial(
  id: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const payload = parseFormData(formData);
  const { data, error } = await supabase
    .from("testimonials")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Testimonial not found.", "not_found");
  await recordAdminAction({
    action: "testimonial.update",
    resource_type: "testimonial",
    resource_id: id,
    payload: { fields_changed: Object.keys(payload) },
  });
  revalidatePath("/admin/testimonials");
  revalidatePath("/results");
  return ok();
}

export async function deleteTestimonial(id: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("testimonials")
    .delete()
    .eq("id", id)
    .select("id, name")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Testimonial not found.", "not_found");
  await recordAdminAction({
    action: "testimonial.delete",
    resource_type: "testimonial",
    resource_id: id,
    payload: { name: data.name },
  });
  revalidatePath("/admin/testimonials");
  revalidatePath("/results");
  return ok();
}

export async function toggleTestimonialVisible(
  id: string,
  next: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("testimonials")
    .update({ is_visible: next })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Testimonial not found.", "not_found");
  await recordAdminAction({
    action: "testimonial.approve",
    resource_type: "testimonial",
    resource_id: id,
    payload: { visible: next },
  });
  revalidatePath("/admin/testimonials");
  revalidatePath("/results");
  return ok();
}
