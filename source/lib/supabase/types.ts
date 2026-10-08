export interface BlogPost {
  id: string
  title: string
  slug: string
  author_id: string | null
  author_slug: string | null
  published_at: string | null
  excerpt: string | null
  featured_image_url: string | null
  featured_image_alt: string | null
  body: Record<string, unknown>
  categories: string[]
  status: 'draft' | 'published' | 'scheduled'
  meta_description: string | null
  created_at: string
  updated_at: string
}

/** A staged edit waiting beside its live post (migration 001). */
export interface BlogPostStagedChange {
  id: string
  post_id: string
  title: string
  slug: string
  excerpt: string | null
  featured_image_url: string | null
  featured_image_alt: string | null
  body: Record<string, unknown>
  categories: string[]
  meta_description: string | null
  author_slug: string | null
  review_status: 'staged' | 'in_review' | 'approved'
  staged_by: string | null
  staged_at: string
  review_requested_by: string | null
  review_requested_at: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface UserRole {
  id: string
  user_id: string
  role: 'super_admin' | 'admin' | 'editor'
  created_at: string
}
