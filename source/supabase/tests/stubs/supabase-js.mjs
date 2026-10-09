// Stand-in for `@supabase/supabase-js` (the redirect lookup imports it; the
// tests reach the database through PGlite or other stand-ins instead).
export function createClient() {
  return { from: () => ({}), rpc: async () => ({ data: null, error: null }) }
}
