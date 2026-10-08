"use server";

// Server actions for staging and approval. Every action re-checks the admin
// session (requireAdmin: active admin, two-factor), writes with the admin's
// own cookie session so RLS and the review trigger in migration 001 decide,
// and records one audit row per step. Model: docs/10-staging-and-approval.md.

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
import {
  availableActions,
  checkPublishSelection,
  pickStagedContent,
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
 * The live post is not touched. Saving resets any review or approval.
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
    .select("id")
    .eq("post_id", postId)
    .maybeSingle();

  const write = existing
    ? supabase.from("blog_post_staged_changes").update(picked).eq("id", existing.id)
    : supabase.from("blog_post_staged_changes").insert({ post_id: postId, ...picked });
  const { data, error } = await write.select("id").single();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Post not found.", "not_found");

  await recordAdminAction({
    action: "blog_post.stage",
    resource_type: "blog_post",
    resource_id: postId,
    payload: { title: picked.title, slug: picked.slug, created: !existing },
  });
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
): Promise<ActionResult<{ published: number }>> {
  await requireAdmin();
  const unique = Array.from(new Set(stageIds));
  const ids = unique.filter((id) => typeof id === "string" && UUID.test(id));
  if (ids.length === 0 || ids.length !== unique.length)
    return err("Pick at least one staged change to publish.", "validation");

  const supabase = await createServerSupabaseClient();
  const { data: picked, error: readError } = await supabase
    .from("blog_post_staged_changes")
    .select("id, post_id, title, slug, review_status, staged_by, approved_by, post:blog_posts(slug)")
    .in("id", ids);
  const readWrapped = wrapSupabaseError(readError);
  if (readWrapped) return readWrapped;
  const rows = (picked ?? []) as unknown as (StageRow & { post: { slug: string } | null })[];
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

  const { error } = await supabase.rpc("publish_staged_posts", { stage_ids: ids });
  const wrapped = wrapSupabaseError(error, SLUG_TAKEN);
  if (wrapped) return wrapped;

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
  return ok({ published: rows.length });
}

/**
 * "Publish now" in the editor: stage the content, then publish that one
 * change. If the publish fails, the work is safe in the staged copy.
 */
export async function publishNow(
  postId: string,
  content: Record<string, unknown>
): Promise<ActionResult> {
  const staged = await stageChanges(postId, content);
  if (!staged.ok) return staged;
  const published = await publishStaged([staged.data!.stageId]);
  if (!published.ok)
    return err(`${published.error} Your changes are saved as a staged copy.`, published.code);
  return ok();
}
