"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require";
import { recordAdminAction } from "@/lib/auth/audit";
import { altTextRefusal, bodyImagesMissingAlt } from "@/lib/admin/alt-text";
import { bulkSummary, isBulkAction, planBulk, MAX_BULK, type BulkAction } from "@/lib/admin/bulk";
import { promoteImages } from "@/lib/staging/promote-images";
import { REVIEW_REQUIRED } from "@/lib/staging/rules";
import {
  ok,
  err,
  type ActionResult,
  wrapSupabaseError,
} from "@/lib/admin/action-result";

function generateCopySlugSuffix(): string {
  return `copy-${Date.now().toString(36)}`;
}

export async function deletePost(id: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("blog_posts")
    .delete()
    .eq("id", id)
    .select("id, slug, title")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Post not found.", "not_found");
  await recordAdminAction({
    action: "blog_post.delete",
    resource_type: "blog_post",
    resource_id: id,
    payload: { slug: data.slug, title: data.title },
  });
  revalidatePath("/admin/posts");
  revalidatePath("/blog");
  return ok();
}

/**
 * Sets the post status to `published` or `draft` based on the `next` flag.
 *
 * The `next` boolean is the desired post-toggle state - true means publish,
 * false means draft. This matches the `<ToggleButton>` contract exactly so
 * the optimistic UI and the server mutation cannot diverge under concurrent
 * edits.
 *
 * Posts with the legacy `scheduled` status get treated like `draft` for
 * toggle purposes - clicking the badge on a scheduled post publishes it
 * immediately.
 */
export async function togglePostStatus(
  id: string,
  next: boolean
): Promise<ActionResult<{ imageWarning?: string }>> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const updates: Record<string, unknown> = {
    status: next ? "published" : "draft",
  };
  let goingLive: { featured_image_url?: unknown; body?: unknown } | null = null;
  if (next) {
    // Going live: alt text first; the staged images go public once the
    // publish write below has succeeded.
    const { data: post, error: readError } = await supabase
      .from("blog_posts")
      .select("featured_image_url, featured_image_alt, body")
      .eq("id", id)
      .maybeSingle();
    const readWrapped = wrapSupabaseError(readError);
    if (readWrapped) return readWrapped;
    if (!post) return err("Post not found.", "not_found");
    const missing = altTextRefusal({
      featuredImageUrl: post.featured_image_url,
      featuredImageAlt: post.featured_image_alt,
      body: post.body,
    });
    if (missing) return err(missing, "validation");
    updates.published_at = new Date().toISOString();
    goingLive = post;
  }
  const { data, error } = await supabase
    .from("blog_posts")
    .update(updates)
    .eq("id", id)
    .select("id, featured_image_url, body")
    .maybeSingle();
  const wrapped = wrapSupabaseError(error);
  if (wrapped) return wrapped;
  if (!data) return err("Post not found.", "not_found");
  await recordAdminAction({
    action: next ? "blog_post.publish" : "blog_post.unpublish",
    resource_type: "blog_post",
    resource_id: id,
    payload: { status: next ? "published" : "draft" },
  });
  revalidatePath("/admin/posts");
  revalidatePath("/blog");
  if (goingLive) {
    // Promote from the row as written, never the one read before the write.
    const failed = await promoteImages(data, id);
    if (failed)
      return ok({
        imageWarning: `Published, but an image could not be made public yet. Open the post and press Make images public to try again. ${failed}`,
      });
  }
  return ok({});
}

export async function duplicatePost(
  id: string
): Promise<ActionResult<{ newId: string }>> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();

  const { data: source, error: readError } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", id)
    .single();

  if (readError) {
    if (readError.code === "PGRST116") {
      return err("Source post not found.", "not_found");
    }
    const wrapped = wrapSupabaseError(readError);
    if (wrapped) return wrapped;
  }
  if (!source) {
    return err("Source post not found.", "not_found");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("blog_posts")
    .insert({
      title: `${source.title} (Copy)`,
      slug: `${source.slug}-${generateCopySlugSuffix()}`,
      excerpt: source.excerpt,
      meta_description: source.meta_description,
      categories: source.categories,
      featured_image_url: source.featured_image_url,
      featured_image_alt: source.featured_image_alt,
      status: "draft",
      body: source.body,
      author_slug: source.author_slug,
    })
    .select("id")
    .single();

  const wrapped = wrapSupabaseError(insertError);
  if (wrapped) return wrapped;
  if (!inserted) return err("Duplicate succeeded but returned no id.", "server");

  await recordAdminAction({
    action: "blog_post.duplicate",
    resource_type: "blog_post",
    resource_id: inserted.id as string,
    payload: {
      source_id: source.id,
      source_title: source.title,
      source_slug: source.slug,
    },
  });

  revalidatePath("/admin/posts");
  return ok({ newId: inserted.id as string });
}

/**
 * Publish, unpublish or delete several posts at once (the posts list's
 * checkboxes). The posts are read again here and planned with
 * lib/admin/bulk.ts, so the browser's copy is never trusted: live posts are
 * not re-published, posts missing alt text are skipped, nothing is
 * published while review is required, and a post with a staged change is
 * not deleted. Each applied post is audited on its own.
 */
export async function bulkPostAction(
  action: BulkAction,
  ids: string[]
): Promise<ActionResult<{ applied: number; skipped: number; summary: string }>> {
  await requireAdmin();
  if (!isBulkAction(action)) return err("Unknown bulk action.", "validation");
  const unique = Array.from(new Set(ids)).filter((id) => typeof id === "string");
  if (unique.length === 0) return err("Pick at least one post.", "validation");
  if (unique.length > MAX_BULK) return err(`Pick at most ${MAX_BULK} posts at a time.`, "validation");

  const supabase = await createServerSupabaseClient();
  const { data: posts, error: readError } = await supabase
    .from("blog_posts")
    .select("id, title, slug, status, featured_image_url, featured_image_alt, body")
    .in("id", unique);
  const readWrapped = wrapSupabaseError(readError);
  if (readWrapped) return readWrapped;
  // A failed read must stop the run: an empty list here would let bulk delete
  // take posts whose staged work the foreign key then deletes with them.
  const { data: staged, error: stagedError } = await supabase
    .from("blog_post_staged_changes")
    .select("post_id")
    .in("post_id", unique);
  const stagedWrapped = wrapSupabaseError(stagedError);
  if (stagedWrapped) return stagedWrapped;
  const withStage = new Set((staged ?? []).map((r) => r.post_id as string));

  const rows = posts ?? [];
  const plan = planBulk(
    action,
    rows.map((p) => ({
      id: p.id as string,
      title: p.title as string,
      status: p.status as "draft" | "published" | "scheduled",
      missingAlt:
        bodyImagesMissingAlt(p.body) +
        (p.featured_image_url && !String(p.featured_image_alt ?? "").trim() ? 1 : 0),
      hasStagedCopy: withStage.has(p.id as string),
    })),
    { reviewRequired: REVIEW_REQUIRED }
  );

  const byId = new Map(rows.map((p) => [p.id as string, p]));
  const applied: string[] = [];
  const imagesPending: string[] = [];
  for (const id of plan.apply) {
    const post = byId.get(id)!;
    let error;
    let written: { featured_image_url?: unknown; body?: unknown } | null = null;
    if (action === "delete") {
      ({ error } = await supabase.from("blog_posts").delete().eq("id", id));
    } else if (action === "publish") {
      ({ error, data: written } = await supabase
        .from("blog_posts")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", id)
        .select("featured_image_url, body")
        .maybeSingle());
    } else {
      ({ error } = await supabase.from("blog_posts").update({ status: "draft" }).eq("id", id));
    }
    if (error) {
      plan.skipped.push({ id, title: post.title as string, reason: error.message });
      continue;
    }
    applied.push(id);
    // The images go public only after the publish write succeeded.
    if (action === "publish" && written && (await promoteImages(written, id))) imagesPending.push(post.title as string);
    await recordAdminAction({
      action:
        action === "delete" ? "blog_post.delete" : action === "publish" ? "blog_post.publish" : "blog_post.unpublish",
      resource_type: "blog_post",
      resource_id: id,
      payload: { slug: post.slug, title: post.title, bulk: plan.apply.length },
    });
  }
  plan.apply = applied;

  revalidatePath("/admin/posts");
  revalidatePath("/blog");
  const pending = imagesPending.length
    ? ` Images not public yet for: ${imagesPending.join(", ")}. Open each post and press Make images public.`
    : "";
  return ok({ applied: applied.length, skipped: plan.skipped.length, summary: bulkSummary(action, plan) + pending });
}
