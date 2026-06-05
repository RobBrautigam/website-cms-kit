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

export interface UserRole {
  id: string
  user_id: string
  role: 'super_admin' | 'admin' | 'editor'
  created_at: string
}
