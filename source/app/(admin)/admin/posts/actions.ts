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
 * The `next` boolean is the desired post-toggle state — true means publish,
 * false means draft. This matches the `<ToggleButton>` contract exactly so
 * the optimistic UI and the server mutation cannot diverge under concurrent
 * edits.
 *
 * Posts with the legacy `scheduled` status get treated like `draft` for
 * toggle purposes — clicking the badge on a scheduled post publishes it
 * immediately.
 */
export async function togglePostStatus(
  id: string,
  next: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const updates: Record<string, unknown> = {
    status: next ? "published" : "draft",
  };
  if (next) {
    updates.published_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("blog_posts")
    .update(updates)
    .eq("id", id)
    .select("id")
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
  return ok();
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
