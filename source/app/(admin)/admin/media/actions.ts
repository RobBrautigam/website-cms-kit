"use server";

// Server actions for the media library (1.5.0, docs/13-media-library.md).
// Every action re-checks the admin session (requireAdmin: active admin,
// two-factor). Alt text and deletes are written with the admin's own cookie
// session, so migration 004's policies decide; the reads that span every
// post run on the service role after the check. Nothing here writes the
// public bucket or the promotion ledger: promotion
// (lib/staging/promote-images.ts) stays the only way in.

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { recordAdminAction } from "@/lib/auth/audit";
import { PUBLIC_BUCKET, STAGED_BUCKET, isImagePath } from "@/lib/staging/images";
import { cleanAlt, MEDIA_ALT_MAX, type MediaAsset, type MediaState } from "@/lib/media/library";
import { loadMediaLibrary } from "@/lib/media/load";
import { ok, err, type ActionResult, wrapSupabaseError } from "@/lib/admin/action-result";

const NOT_OURS = "That is not an image the kit uploaded.";

/** The whole library, for the media screen. */
export async function loadMediaLibraryAction(): Promise<ActionResult<{ assets: MediaAsset[] }>> {
  await requireAdmin();
  const result = await loadMediaLibrary();
  if ("error" in result) return err(result.error, "server");
  return ok({ assets: result.assets });
}

export type PickerAsset = { path: string; url: string; alt: string; state: MediaState };

/**
 * Every image an editor can pick again, with its saved alt text to offer.
 * The URL is the final public address, the same text a fresh upload would
 * put in the content, so reuse needs no second upload and the two-person
 * lock's exact match still holds.
 */
export async function listMediaForPicker(): Promise<ActionResult<PickerAsset[]>> {
  await requireAdmin();
  const result = await loadMediaLibrary({ uses: false });
  if ("error" in result) return err(result.error, "server");
  const svc = createServiceClient();
  return ok(
    result.assets.map((a) => ({
      path: a.path,
      url: svc.storage.from(PUBLIC_BUCKET).getPublicUrl(a.path).data.publicUrl,
      alt: a.alt,
      state: a.state,
    }))
  );
}

/** Save the alt text kept for one image file (offered the next time it is picked). */
export async function saveMediaAlt(path: string, alt: string): Promise<ActionResult<{ alt: string }>> {
  await requireAdmin();
  if (!isImagePath(path)) return err(NOT_OURS, "validation");
  const text = cleanAlt(alt);
  if (text === null) return err(`Alt text is at most ${MEDIA_ALT_MAX} characters.`, "validation");
  const supabase = await createServerSupabaseClient();
  const { data: updated, error: updateError } = await supabase
    .from("blog_media")
    .update({ alt: text })
    .eq("path", path)
    .select("path")
    .maybeSingle();
  const updateWrapped = wrapSupabaseError(updateError);
  if (updateWrapped) return updateWrapped;
  if (!updated) {
    const { error: insertError } = await supabase.from("blog_media").insert({ path, alt: text });
    // Two admins saving the first text at once: the second one updates.
    if (insertError?.code === "23505") {
      const { error } = await supabase.from("blog_media").update({ alt: text }).eq("path", path);
      const wrapped = wrapSupabaseError(error);
      if (wrapped) return wrapped;
    } else {
      const wrapped = wrapSupabaseError(insertError);
      if (wrapped) return wrapped;
    }
  }
  await recordAdminAction({
    action: "media.alt_update",
    resource_type: "media",
    resource_id: path,
    payload: { alt: text },
  });
  revalidatePath("/admin/media");
  return ok({ alt: text });
}

/**
 * Delete one image file nothing uses. A used file (any post, staged copy or
 * kept revision) is refused here and again by the storage policies (migration
 * 004), so a live page never loses its picture. The delete runs on the
 * admin's own session: with review required, staged files are write-once and
 * the policy keeps them (the staged-image cleanup removes unused ones). The
 * promotion ledger row is kept on purpose, so a later upload at the same
 * path can never be promoted into the deleted file's place.
 */
export async function deleteMediaAsset(path: string): Promise<ActionResult<{ removedFrom: string[] }>> {
  await requireAdmin();
  if (!isImagePath(path)) return err(NOT_OURS, "validation");
  const supabase = await createServerSupabaseClient();
  const { data: inUse, error: useError } = await supabase.rpc("blog_image_in_use", { image_path: path });
  if (useError) {
    return err(
      `Could not check whether the image is in use (${useError.message}). Check that migration 004 has run. Nothing was deleted.`,
      "server"
    );
  }
  if (inUse !== false) {
    return err(
      "This image is in use by a post, a staged change or a kept revision. Remove it from them first; a used image is never deleted.",
      "conflict"
    );
  }
  const removedFrom: string[] = [];
  for (const bucket of [PUBLIC_BUCKET, STAGED_BUCKET]) {
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    if (error) return err(`Could not delete the image (${error.message}).`, "server");
    if (data && data.length > 0) removedFrom.push(bucket);
  }
  if (removedFrom.length === 0) {
    return err(
      "Nothing was deleted. Either the file is already gone, or review is required and staged images are write-once until their post goes live (the staged-image cleanup in Settings removes unused ones after 48 hours).",
      "conflict"
    );
  }
  // The alt text goes with the file. Clients cannot delete these rows, so the
  // server does, after the admin's own delete succeeded.
  const { error: altError } = await createServiceClient().from("blog_media").delete().eq("path", path);
  if (altError) console.error("deleteMediaAsset: alt text not removed", altError.message);
  await recordAdminAction({
    action: "media.delete",
    resource_type: "media",
    resource_id: path,
    payload: { removed_from: removedFrom },
  });
  revalidatePath("/admin/media");
  return ok({ removedFrom });
}
