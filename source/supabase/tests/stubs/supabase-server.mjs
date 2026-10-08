// Stand-in for `@/lib/supabase/server`. Storage is an in-memory pair of
// buckets (fakes.storage); everything else does nothing.
import { fakes } from './stubs.mjs'

function bucket(name) {
  const files = () => (name === 'blog-images-staged' ? fakes.storage.staged : fakes.storage.public)
  return {
    async copy(from, to, opts = {}) {
      if (fakes.storage.failCopy) return { data: null, error: { message: fakes.storage.failCopy } }
      if (!files().has(from)) return { data: null, error: { message: 'Object not found' } }
      const dest = opts.destinationBucket === 'blog-images' ? fakes.storage.public : files()
      if (dest.has(to)) return { data: null, error: { message: 'The resource already exists' } }
      dest.add(to)
      return { data: { path: to }, error: null }
    },
    async remove(paths) {
      for (const p of paths) files().delete(p)
      return { data: paths.map((name) => ({ name })), error: null }
    },
  }
}

const client = () => ({
  auth: { mfa: { unenroll: async () => ({ error: null }) } },
  from: () => ({}),
  rpc: async () => ({ data: null, error: null }),
  storage: { from: bucket },
})
export const createServiceClient = client
export const createAnonServerClient = client
export async function createServerSupabaseClient() {
  return client()
}
