"use server";

// Server actions for staging and approval. Every action re-checks the admin
// session (requireAdmin: active admin, two-factor), writes with the admin's
// own cookie session so RLS and the review trigger in migration 001 decide,
// and records one audit row per step. Model: docs/10-staging-and-approval.md.

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/require";
import { altTextRefusal } from "@/lib/admin/alt-text";
import { promoteImages } from "@/lib/staging/promote-images";
import { STAGED_BUCKET, imagePathsIn } from "@/lib/staging/images";
import { planOrphanCleanup } from "@/lib/staging/orphans";
import { recordAdminAction } from "@/lib/auth/audit";
import {
  ok,
  err,
  type ActionResult,
  wrapSupabaseError,
} from "@/lib/admin/action-result";
import {
  availableActions,
  checkPublishSelection,
  pickStagedContent,
  publishNowRefusal,
  type ReviewStatus,
  type StagedSummary,
} from "@/lib/staging/rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_TAKEN = "Another post already uses that slug. Nothing was published.";

function revalidateStaging(postId?: string) {
  revalidatePath("/admin/staging");
  revalidatePath("/admin/posts");
  if (postId) revalidatePath(`/admin/posts/${postId}/edit`);
}

interface StageRow {
  id: string;
  post_id: string;
  title: string;
  slug: string;
  review_status: ReviewStatus;
  staged_by: string | null;
  approved_by: string | null;
}

async function readStage(stageId: string): Promise<StageRow | null> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("blog_post_staged_changes")
    .select("id, post_id, title, slug, review_status, staged_by, approved_by")
    .eq("id", stageId)
    .maybeSingle();
  return (data as StageRow | null) ?? null;
}

/**
 * Save the editor's content as the post's staged copy (create or replace).
 * The live post is not touched. Changing the content resets any review or
 * approval (the trigger does it), and the reset is audited as a withdrawal.
 */
export async function stageChanges(
  postId: string,
  content: Record<string, unknown>
): Promise<ActionResult<{ stageId: string }>> {
  await requireAdmin();
  if (!UUID.test(postId)) return err("Unknown post.", "validation");
  const picked = pickStagedContent(content);
  if (!picked.title.trim()) return err("Title is required.", "validation");
  if (!picked.slug.trim()) return err("Slug is required.", "validation");

  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("blog_post_staged_changes")
    .select("id, review_status")
    .eq("post_id", postId)
    .maybeSingle();

  const write = existing
    ? supabase.from("blog_post_staged_changes").update(picked).eq("id", existing.id)
    : supabase.from("blog_post_staged_changes").insert({ post_id: postId, ...picked });
  const { data, error } = await write.select("id, review_status").single();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Post not found.", "not_found");

  await recordAdminAction({
    action: "blog_post.stage",
    resource_type: "blog_post",
    resource_id: postId,
    payload: { title: picked.title, slug: picked.slug, created: !existing },
  });
  if (existing && existing.review_status !== "staged" && data.review_status === "staged") {
    await recordAdminAction({
      action: "blog_post.withdraw_review",
      resource_type: "blog_post",
      resource_id: postId,
      payload: { title: picked.title, from: existing.review_status, reason: "content changed" },
    });
  }
  revalidateStaging(postId);
  return ok({ stageId: data.id as string });
}

async function moveReview(
  stageId: string,
  to: ReviewStatus,
  action: "blog_post.request_review" | "blog_post.approve" | "blog_post.withdraw_review"
): Promise<ActionResult> {
  const { user } = await requireAdmin();
  if (!UUID.test(stageId)) return err("Unknown staged change.", "validation");
  const stage = await readStage(stageId);
  if (!stage) return err("That staged change is gone (published or discarded).", "not_found");

  const allowed = availableActions(
    { reviewStatus: stage.review_status, stagedBy: stage.staged_by },
    user.id
  );
  if (to === "in_review" && !allowed.requestReview)
    return err("Only a staged change can be sent for review.", "validation");
  if (to === "approved" && !allowed.approve)
    return err(
      stage.staged_by === user.id
        ? "You cannot approve a change you staged. Ask a teammate to approve it."
        : "Only a change waiting in review can be approved.",
      "validation"
    );
  if (to === "staged" && !allowed.withdraw)
    return err("There is no review request to withdraw.", "validation");

  // The trigger in migration 001 enforces the same rules and owns the
  // reviewer columns; this only asks for the new state.
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("blog_post_staged_changes")
    .update({ review_status: to })
    .eq("id", stageId)
    .select("id")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("That staged change is gone (published or discarded).", "not_found");

  await recordAdminAction({
    action,
    resource_type: "blog_post",
    resource_id: stage.post_id,
    payload:
      action === "blog_post.approve"
        ? { title: stage.title, staged_by: stage.staged_by }
        : action === "blog_post.withdraw_review"
          ? { title: stage.title, from: stage.review_status }
          : { title: stage.title },
  });
  revalidateStaging(stage.post_id);
  return ok();
}

export async function requestReview(stageId: string): Promise<ActionResult> {
  return moveReview(stageId, "in_review", "blog_post.request_review");
}

export async function approveStaged(stageId: string): Promise<ActionResult> {
  return moveReview(stageId, "approved", "blog_post.approve");
}

export async function withdrawReview(stageId: string): Promise<ActionResult> {
  return moveReview(stageId, "staged", "blog_post.withdraw_review");
}

/** Delete a staged copy. The live post is untouched. */
export async function discardStaged(stageId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!UUID.test(stageId)) return err("Unknown staged change.", "validation");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("blog_post_staged_changes")
    .delete()
    .eq("id", stageId)
    .select("id, post_id, title")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("That staged change is gone (published or discarded).", "not_found");

  await recordAdminAction({
    action: "blog_post.discard_staged",
    resource_type: "blog_post",
    resource_id: data.post_id as string,
    payload: { title: data.title },
  });
  revalidateStaging(data.post_id as string);
  return ok();
}

/**
 * Publish the picked staged changes together: all of them go live or none
 * do (publish_staged_posts() in migration 001 is one transaction).
 */
export async function publishStaged(
  stageIds: string[]
): Promise<ActionResult<{ published: number; imageWarning?: string }>> {
  await requireAdmin();
  const unique = Array.from(new Set(stageIds));
  const ids = unique.filter((id) => typeof id === "string" && UUID.test(id));
  if (unique.length === 0) return err("Pick at least one staged change to publish.", "validation");
  if (ids.length !== unique.length)
    return err("One of the picked changes is not valid. Reload the page and pick again.", "validation");

  const supabase = await createServerSupabaseClient();
  const { data: picked, error: readError } = await supabase
    .from("blog_post_staged_changes")
    .select("id, post_id, title, slug, review_status, staged_by, approved_by, featured_image_url, featured_image_alt, body, post:blog_posts(slug)")
    .in("id", ids);
  const readWrapped = wrapSupabaseError(readError);
  if (readWrapped) return readWrapped;
  const rows = (picked ?? []) as unknown as (StageRow & {
    post: { slug: string } | null;
    featured_image_url: string | null;
    featured_image_alt: string | null;
    body: unknown;
  })[];
  if (rows.length !== ids.length)
    return err("Some picked changes were not found (published by someone else, or discarded). Nothing was published.", "not_found");

  const summaries: StagedSummary[] = rows.map((r) => ({
    id: r.id,
    reviewStatus: r.review_status,
    stagedBy: r.staged_by,
    title: r.title,
  }));
  const check = checkPublishSelection(summaries);
  if (!check.ok) return err(check.message, "validation");

  // Nothing goes live without alt text.
  for (const r of rows) {
    const missing = altTextRefusal({
      featuredImageUrl: r.featured_image_url,
      featuredImageAlt: r.featured_image_alt,
      body: r.body,
    });
    if (missing) return err(`"${r.title}": ${missing} Nothing was published.`, "validation");
  }

  const { error } = await supabase.rpc("publish_staged_posts", { stage_ids: ids });
  const wrapped = wrapSupabaseError(error, SLUG_TAKEN);
  if (wrapped) return wrapped;

  // Only now, with the publish written, do the images leave the private
  // staged bucket (lib/staging/promote-images.ts): a publish the lock refuses
  // never makes anything public.
  const imageWarning = await promoteAfterPublish(rows);

  for (const r of rows) {
    await recordAdminAction({
      action: "blog_post.publish_staged",
      resource_type: "blog_post",
      resource_id: r.post_id,
      payload: {
        title: r.title,
        slug: r.slug,
        review_status: r.review_status,
        approved_by: r.approved_by,
        batch: rows.length,
      },
    });
  }
  revalidateStaging();
  revalidatePath("/blog");
  for (const r of rows) {
    revalidatePath(`/blog/${r.slug}`);
    if (r.post?.slug && r.post.slug !== r.slug) revalidatePath(`/blog/${r.post.slug}`);
    revalidatePath(`/admin/posts/${r.post_id}/edit`);
  }
  return ok({ published: rows.length, ...(imageWarning ? { imageWarning } : {}) });
}

/**
 * Make the images of posts that just went live public. A failure here is
 * not a failed publish (the posts ARE live), so it comes back as a warning;
 * the editor offers "Make images public" (promotePostImages) to try again.
 */
async function promoteAfterPublish(
  rows: { post_id: string; title: string; featured_image_url?: unknown; body?: unknown }[]
): Promise<string | undefined> {
  const problems: string[] = [];
  for (const r of rows) {
    const failed = await promoteImages(r, r.post_id);
    if (failed) problems.push(`"${r.title}": ${failed}`);
  }
  if (problems.length === 0) return undefined;
  return `Published, but ${problems.length === 1 ? "an image" : "some images"} could not be made public yet. Open the post and press Make images public to try again. ${problems.join(" ")}`;
}

/**
 * "Publish now" in the editor: stage the content, then publish that one
 * change. If the publish fails, the work is safe in the staged copy. A change
 * waiting for review is refused rather than silently taken out of review.
 */
export async function publishNow(
  postId: string,
  content: Record<string, unknown>
): Promise<ActionResult<{ imageWarning?: string }>> {
  await requireAdmin();
  if (!UUID.test(postId)) return err("Unknown post.", "validation");
  const supabase = await createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("blog_post_staged_changes")
    .select("review_status")
    .eq("post_id", postId)
    .maybeSingle();
  const refusal = publishNowRefusal((existing?.review_status as ReviewStatus | undefined) ?? null);
  if (refusal) return err(refusal, "validation");

  const staged = await stageChanges(postId, content);
  if (!staged.ok) return staged;
  const published = await publishStaged([staged.data!.stageId]);
  if (!published.ok)
    return err(`${published.error} Your changes are saved as a staged copy.`, published.code);
  return ok({ imageWarning: published.data?.imageWarning });
}

/**
 * Before the editor saves a post as published or scheduled directly (review
 * off, a post that is not live yet): check its alt text. The editor then
 * writes the row with the admin's session and, once that write succeeded,
 * calls promotePostImages.
 */
export async function prepareToGoLive(content: {
  featured_image_url?: string | null;
  featured_image_alt?: string | null;
  body?: unknown;
}): Promise<ActionResult> {
  await requireAdmin();
  const missing = altTextRefusal({
    featuredImageUrl: content.featured_image_url,
    featuredImageAlt: content.featured_image_alt,
    body: content.body,
  });
  if (missing) return err(missing, "validation");
  return ok();
}

/**
 * Make a live or scheduled post's images public: right after the editor's
 * own publish write, and as the "Make images public" retry. The paths come
 * from the stored post, never from the caller, and a draft is refused: its
 * content has not been through the publish path (or the lock) yet.
 */
export async function promotePostImages(postId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!UUID.test(postId)) return err("Unknown post.", "validation");
  const supabase = await createServerSupabaseClient();
  const { data: post, error } = await supabase
    .from("blog_posts")
    .select("id, title, status, featured_image_url, body")
    .eq("id", postId)
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!post) return err("Post not found.", "not_found");
  if (post.status !== "published" && post.status !== "scheduled")
    return err("Only a live or scheduled post's images are made public. Publish the post first.", "validation");
  const failed = await promoteImages(post, postId);
  if (failed) return err(failed, "server");
  await recordAdminAction({
    action: "blog_post.images_promoted",
    resource_type: "blog_post",
    resource_id: postId,
    payload: { title: post.title },
  });
  revalidatePath(`/admin/posts/${postId}/edit`);
  return ok();
}

/**
 * Autosave for a post edited through its staged copy (live, scheduled, or a
 * draft that has one). The content goes into the staged copy, and only while
 * nobody has sent it for review: the update is filtered on
 * review_status = 'staged', so an autosave never resets a review a teammate
 * started. Quiet on purpose: the autosave that creates the staged copy is
 * audited once (blog_post.stage); the pauses after it are not, since the
 * explicit Stage changes is the audited step.
 */
export async function autosaveStaged(
  postId: string,
  content: Record<string, unknown>
): Promise<ActionResult<{ saved?: boolean; paused?: boolean }>> {
  await requireAdmin();
  if (!UUID.test(postId)) return err("Unknown post.", "validation");
  const picked = pickStagedContent(content);
  if (!picked.title.trim() || !picked.slug.trim())
    return err("A title and a slug are needed before autosave.", "validation");
  const supabase = await createServerSupabaseClient();

  const updateOpen = async () =>
    supabase
      .from("blog_post_staged_changes")
      .update(picked)
      .eq("post_id", postId)
      .eq("review_status", "staged")
      .select("id")
      .maybeSingle();
  const first = await updateOpen();
  const wrapped = wrapSupabaseError(first.error);
  if (wrapped) return wrapped;
  if (first.data) return ok({ saved: true });

  const { data: existing } = await supabase
    .from("blog_post_staged_changes")
    .select("id")
    .eq("post_id", postId)
    .maybeSingle();
  if (existing) return ok({ paused: true });

  const { data: created, error: insertError } = await supabase
    .from("blog_post_staged_changes")
    .insert({ post_id: postId, ...picked })
    .select("id")
    .single();
  if (insertError?.code === "23505") {
    // A teammate created one a moment ago: write into it if it is still open.
    const retry = await updateOpen();
    return retry.data ? ok({ saved: true }) : ok({ paused: true });
  }
  const insertWrapped = wrapSupabaseError(insertError);
  if (insertWrapped) return insertWrapped;
  if (!created) return err("Post not found.", "not_found");
  await recordAdminAction({
    action: "blog_post.stage",
    resource_type: "blog_post",
    resource_id: postId,
    payload: { title: picked.title, slug: picked.slug, created: true, autosave: true },
  });
  revalidateStaging(postId);
  return ok({ saved: true });
}

const RESTORE_BLOCKED = "This post already has a staged change. Publish or discard it first, then restore.";

/**
 * Restore an earlier version of a live or scheduled post (docs/12). The
 * revision's content becomes the post's staged copy, so it goes live the way
 * any edit does: Publish when review is off, a teammate's approval when it is
 * on. The live post is not touched here. Refused while the post already has
 * a staged change, so a restore never overwrites work in progress or a
 * change in review.
 */
export async function restoreRevision(
  revisionId: string
): Promise<ActionResult<{ stageId: string }>> {
  await requireAdmin();
  if (!UUID.test(revisionId)) return err("Unknown revision.", "validation");
  const supabase = await createServerSupabaseClient();
  const { data: rev, error } = await supabase
    .from("blog_post_revisions")
    .select("id, post_id, seq, title, slug, excerpt, featured_image_url, featured_image_alt, body, categories, meta_description, author_slug")
    .eq("id", revisionId)
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!rev) return err("That revision is gone (the post keeps its latest 100).", "not_found");

  const { data: existing } = await supabase
    .from("blog_post_staged_changes")
    .select("id")
    .eq("post_id", rev.post_id)
    .maybeSingle();
  if (existing) return err(RESTORE_BLOCKED, "conflict");

  const picked = pickStagedContent(rev);
  const { data, error: insertError } = await supabase
    .from("blog_post_staged_changes")
    .insert({ post_id: rev.post_id, ...picked })
    .select("id")
    .single();
  const insertWrapped = wrapSupabaseError(insertError, RESTORE_BLOCKED);
  if (insertWrapped) return insertWrapped;
  if (!data) return err("Post not found.", "not_found");
  await recordAdminAction({
    action: "blog_post.restore_revision",
    resource_type: "blog_post",
    resource_id: rev.post_id as string,
    payload: { revision: rev.seq, title: picked.title },
  });
  revalidateStaging(rev.post_id as string);
  return ok({ stageId: data.id as string });
}

/** A date from the editor's datetime field: an ISO string, null when empty, undefined when unreadable. */
function isoOrNull(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value.trim() === "") return null;
  // The editor's fields hold UTC without a zone; read them as UTC, never as
  // the server's own zone.
  const d = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Change when a scheduled post goes live, or when a live or scheduled post
 * comes down (docs/12). Writes with the admin's session, so the database
 * decides: pushing a scheduled date later or setting an end date is always
 * allowed; an earlier publish date under required review needs the staged
 * path (migration 003, section 19c).
 */
export async function updateSchedule(
  postId: string,
  input: { publishAt?: string | null; unpublishAt?: string | null }
): Promise<ActionResult> {
  await requireAdmin();
  if (!UUID.test(postId)) return err("Unknown post.", "validation");
  const updates: Record<string, string | null> = {};
  if (input.publishAt !== undefined) {
    const v = isoOrNull(input.publishAt);
    if (!v) return err("Pick a date and time to publish.", "validation");
    updates.published_at = v;
  }
  if (input.unpublishAt !== undefined) {
    const v = isoOrNull(input.unpublishAt);
    if (v === undefined) return err("Pick a valid end date, or leave it empty.", "validation");
    updates.unpublish_at = v;
  }
  if (Object.keys(updates).length === 0) return err("Nothing to change.", "validation");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .update(updates)
    .eq("id", postId)
    .select("id, slug, title")
    .maybeSingle();
  if (error?.code === "23514" && /unpublish/.test(error.message ?? ""))
    return err("The end date must be after the publish date.", "validation");
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Post not found.", "not_found");
  await recordAdminAction({
    action: "blog_post.schedule_update",
    resource_type: "blog_post",
    resource_id: postId,
    payload: { title: data.title, ...updates },
  });
  revalidatePath("/admin/posts");
  revalidatePath(`/admin/posts/${postId}/edit`);
  revalidatePath("/blog");
  revalidatePath(`/blog/${data.slug}`);
  return ok();
}

/**
 * Remove staged images nothing uses (lib/staging/orphans.ts), super admin
 * only. Lists the private staged bucket on the service role, keeps every
 * path a post, a staged copy or a kept revision still holds, and removes the
 * rest once they are older than ORPHAN_MIN_AGE_HOURS.
 */
export async function cleanupStagedImages(): Promise<ActionResult<{ removed: number; kept: number }>> {
  await requireSuperAdmin();
  const svc = createServiceClient();
  const PAGE = 1000;
  const referenced = new Set<string>();
  for (const table of ["blog_posts", "blog_post_staged_changes", "blog_post_revisions"]) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await svc
        .from(table)
        .select("featured_image_url, body")
        .range(from, from + PAGE - 1);
      if (error) return err(`Could not read ${table}: ${error.message}`, "server");
      for (const row of data ?? []) for (const p of imagePathsIn(row)) referenced.add(p);
      if (!data || data.length < PAGE) break;
    }
  }
  const objects: { name: string; created_at: string | null }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await svc.storage
      .from(STAGED_BUCKET)
      .list("blog", { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) return err(`Could not list the staged images: ${error.message}`, "server");
    for (const o of data ?? []) objects.push({ name: o.name, created_at: o.created_at ?? null });
    if (!data || data.length < PAGE) break;
  }
  const remove = planOrphanCleanup(objects, [...referenced]);
  for (let i = 0; i < remove.length; i += 100) {
    const { error } = await svc.storage.from(STAGED_BUCKET).remove(remove.slice(i, i + 100));
    if (error) return err(`Could not remove the staged images: ${error.message}`, "server");
  }
  await recordAdminAction({
    action: "staging.orphans_cleaned",
    payload: { removed: remove.length, kept: objects.length - remove.length },
  });
  return ok({ removed: remove.length, kept: objects.length - remove.length });
}
