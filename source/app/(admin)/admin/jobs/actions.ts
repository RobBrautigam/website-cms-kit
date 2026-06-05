"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { recordAdminAction } from "@/lib/auth/audit";
import {
  ok,
  err,
  type ActionResult,
  wrapSupabaseError,
} from "@/lib/admin/action-result";

function parseBulletList(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

function parseFormData(formData: FormData) {
  return {
    slug: String(formData.get("slug") ?? "").trim(),
    title: String(formData.get("title") ?? "").trim(),
    department: String(formData.get("department") ?? "").trim(),
    type: String(formData.get("type") ?? "").trim(),
    location: String(formData.get("location") ?? "Remote").trim(),
    summary: String(formData.get("summary") ?? "").trim(),
    responsibilities: parseBulletList(String(formData.get("responsibilities") ?? "")),
    qualifications: parseBulletList(String(formData.get("qualifications") ?? "")),
    is_active: formData.get("is_active") === "on",
    seo_title: String(formData.get("seo_title") ?? "").trim() || null,
    seo_description: String(formData.get("seo_description") ?? "").trim() || null,
    sort_order: Number(formData.get("sort_order") ?? 0),
  };
}

export async function createJob(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const payload = parseFormData(formData);
  const { data: inserted, error } = await supabase
    .from("job_openings")
    .insert(payload)
    .select("id, title, slug, is_active")
    .single();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!inserted) return err("Insert succeeded but returned no row.", "server");
  await recordAdminAction({
    action: "job.create",
    resource_type: "job",
    resource_id: inserted.id as string,
    payload: {
      title: inserted.title,
      slug: inserted.slug,
      is_active: inserted.is_active,
    },
  });
  revalidatePath("/admin/jobs");
  revalidatePath("/careers");
  return ok();
}

export async function updateJob(
  id: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const payload = parseFormData(formData);

  // Read existing slug before update so we can:
  //   1. Verify the row exists (avoid false-success-toast on stale-tab edits)
  //   2. Revalidate the old `/careers/<slug>` path when the slug changes
  //      (without this, a renamed job leaves the old slug cached and serves
  //      a stale page indefinitely)
  const { data: existing, error: readErr } = await supabase
    .from("job_openings")
    .select("slug")
    .eq("id", id)
    .maybeSingle();
  const readWrap = wrapSupabaseError(readErr);
  if (readWrap) return readWrap;
  if (!existing) return err("Job not found.", "not_found");

  const { data: updated, error } = await supabase
    .from("job_openings")
    .update(payload)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!updated) return err("Job not found.", "not_found");

  await recordAdminAction({
    action: "job.update",
    resource_type: "job",
    resource_id: id,
    payload: { fields_changed: Object.keys(payload) },
  });

  revalidatePath("/admin/jobs");
  revalidatePath("/careers");
  if (existing.slug && existing.slug !== payload.slug) {
    revalidatePath(`/careers/${existing.slug}`);
  }
  revalidatePath(`/careers/${payload.slug}`);
  return ok();
}

export async function deleteJob(id: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("job_openings")
    .delete()
    .eq("id", id)
    .select("id, slug, title")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Job not found.", "not_found");
  await recordAdminAction({
    action: "job.delete",
    resource_type: "job",
    resource_id: id,
    payload: { slug: data.slug, title: data.title },
  });
  revalidatePath("/admin/jobs");
  revalidatePath("/careers");
  return ok();
}

export async function toggleJobActive(
  id: string,
  next: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("job_openings")
    .update({ is_active: next })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Job not found.", "not_found");
  await recordAdminAction({
    action: "job.update",
    resource_type: "job",
    resource_id: id,
    payload: { active: next },
  });
  revalidatePath("/admin/jobs");
  revalidatePath("/careers");
  return ok();
}
