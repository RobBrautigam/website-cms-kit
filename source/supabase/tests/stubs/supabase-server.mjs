// Stand-in for `@/lib/supabase/server`. The routes under test reach the
// database only through other stand-ins, so these clients do nothing.
const client = () => ({
  auth: { mfa: { unenroll: async () => ({ error: null }) } },
  from: () => ({}),
  rpc: async () => ({ data: null, error: null }),
})
export const createServiceClient = client
export const createAnonServerClient = client
export async function createServerSupabaseClient() {
  return client()
}
