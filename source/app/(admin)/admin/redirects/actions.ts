"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { recordAdminAction } from "@/lib/auth/audit";
import { redirectInputSchema } from "@/lib/redirects/validate";
import {
  ok,
  err,
  type ActionResult,
  wrapSupabaseError,
} from "@/lib/admin/action-result";

function parseFormToInput(formData: FormData) {
  return {
    source: String(formData.get("source") ?? "").trim(),
    destination: String(formData.get("destination") ?? "").trim(),
    permanent: formData.get("permanent") === "true",
    enabled: formData.get("enabled") === "on",
    category: formData.get("category"),
    notes: formData.get("notes"),
  };
}

export async function createRedirect(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const parsed = redirectInputSchema.safeParse(parseFormToInput(formData));
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((i) => i.message).join("; "),
      "validation"
    );
  }
  const { data: inserted, error } = await supabase
    .from("url_redirects")
    .insert(parsed.data)
    .select("id, source, destination, permanent")
    .single();
  const wrapped = wrapSupabaseError(
    error,
    `A redirect with source "${parsed.data.source}" already exists.`
  );
  if (wrapped) return wrapped;
  if (!inserted) return err("Insert succeeded but returned no row.", "server");
  await recordAdminAction({
    action: "redirect.create",
    resource_type: "redirect",
    resource_id: inserted.id as string,
    payload: {
      source: inserted.source,
      destination: inserted.destination,
      permanent: inserted.permanent,
    },
  });
  revalidatePath("/admin/redirects");
  return ok();
}

export async function updateRedirect(
  id: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const parsed = redirectInputSchema.safeParse(parseFormToInput(formData));
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((i) => i.message).join("; "),
      "validation"
    );
  }
  const { data, error } = await supabase
    .from("url_redirects")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(
    error,
    `A redirect with source "${parsed.data.source}" already exists.`
  );
  if (wrapped) return wrapped;
  if (!data) return err("Redirect not found.", "not_found");
  await recordAdminAction({
    action: "redirect.update",
    resource_type: "redirect",
    resource_id: id,
    payload: { fields_changed: Object.keys(parsed.data) },
  });
  revalidatePath("/admin/redirects");
  return ok();
}

export async function deleteRedirect(id: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("url_redirects")
    .delete()
    .eq("id", id)
    .select("id, source, destination")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Redirect not found.", "not_found");
  await recordAdminAction({
    action: "redirect.delete",
    resource_type: "redirect",
    resource_id: id,
    payload: { source: data.source, destination: data.destination },
  });
  revalidatePath("/admin/redirects");
  return ok();
}

export async function toggleRedirectEnabled(
  id: string,
  next: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("url_redirects")
    .update({ enabled: next })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Redirect not found.", "not_found");
  await recordAdminAction({
    action: "redirect.update",
    resource_type: "redirect",
    resource_id: id,
    payload: { enabled: next },
  });
  revalidatePath("/admin/redirects");
  return ok();
}
