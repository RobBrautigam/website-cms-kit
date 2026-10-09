// Stand-in for `@/lib/supabase/server`. Storage is an in-memory pair of
// buckets (fakes.storage); tables are in-memory row lists (fakes.tables)
// behind a small chainable query builder; rpc answers come from fakes.rpc.
import { calls, fakes } from './stubs.mjs'

function bucket(name) {
  const files = () => (name === 'blog-images-staged' ? fakes.storage.staged : fakes.storage.public)
  return {
    async copy(from, to, opts = {}) {
      calls.order.push(`copy ${from}`)
      if (fakes.storage.failCopy) return { data: null, error: { message: fakes.storage.failCopy } }
      if (!files().has(from)) return { data: null, error: { message: 'Object not found' } }
      const dest = opts.destinationBucket === 'blog-images' ? fakes.storage.public : files()
      if (dest.has(to)) return { data: null, error: { message: 'The resource already exists' } }
      dest.add(to)
      return { data: { path: to }, error: null }
    },
    async remove(paths) {
      calls.order.push(`remove ${name} ${paths.join(',')}`)
      // A storage policy that refuses answers with an empty list, not an error.
      if (fakes.storage.refuseRemove.includes(name)) return { data: [], error: null }
      const gone = paths.filter((p) => files().has(p))
      for (const p of gone) files().delete(p)
      return { data: gone.map((name) => ({ name })), error: null }
    },
    async list() {
      return { data: [...files()].map((p) => ({ name: p.replace(/^blog\//, ''), created_at: '2026-01-01T00:00:00Z' })), error: null }
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://proj.supabase.example/storage/v1/object/public/${name}/${path}` } }
    },
  }
}

// One unique key per table, enough for the 23505 paths the kit handles.
const UNIQUE = { blog_image_promotions: 'path', blog_post_staged_changes: 'post_id' }
// Column defaults the database would fill in.
const DEFAULTS = { blog_post_staged_changes: { review_status: 'staged' } }
let nextId = 1

function table(name) {
  const rows = (fakes.tables[name] ??= [])
  let op = 'select'
  let payload = null
  const filters = []
  const matches = (r) =>
    filters.every(([kind, col, v]) =>
      kind === 'in' ? v.includes(r[col]) : kind === 'lte' ? r[col] != null && String(r[col]) <= String(v) : r[col] === v
    )
  const run = async (single) => {
    calls.queries.push({ table: name, op, payload, filters: filters.map(([, c, v]) => [c, v]) })
    const one = (list) => (single ? (list[0] ?? null) : list)
    if (op === 'insert') {
      if (fakes.failInsert[name]) return { data: null, error: { message: fakes.failInsert[name] } }
      const added = []
      for (const v of Array.isArray(payload) ? payload : [payload]) {
        const key = UNIQUE[name]
        if (key && rows.some((r) => r[key] === v[key])) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
        const row = { id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, ...DEFAULTS[name], ...v }
        rows.push(row)
        added.push(row)
      }
      return { data: one(added), error: null }
    }
    // A teammate's write landing between a read and this update.
    if (op === 'update' && fakes.beforeUpdate[name]) {
      const change = fakes.beforeUpdate[name]
      delete fakes.beforeUpdate[name]
      change(rows)
    }
    const hit = rows.filter(matches)
    if (op === 'update') hit.forEach((r) => Object.assign(r, payload))
    if (op === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1))
    return { data: one(hit), error: null }
  }
  const q = {
    insert(v) { op = 'insert'; payload = v; return q },
    update(v) { op = 'update'; payload = v; return q },
    delete() { op = 'delete'; return q },
    select() { return q },
    order() { return q },
    limit() { return q },
    range() { return q },
    eq(col, v) { filters.push(['eq', col, v]); return q },
    in(col, v) { filters.push(['in', col, v]); return q },
    lte(col, v) { filters.push(['lte', col, v]); return q },
    maybeSingle() { return run(true) },
    single() { return run(true) },
    then(resolve, reject) { return run(false).then(resolve, reject) },
  }
  return q
}

const client = () => ({
  auth: { mfa: { unenroll: async () => ({ error: null }) } },
  from: table,
  rpc: async (name, args) => {
    calls.rpc.push({ name, args })
    calls.order.push(`rpc ${name}`)
    return fakes.rpc[name] ? fakes.rpc[name](args) : { data: null, error: null }
  },
  storage: { from: bucket },
})
export const createServiceClient = client
export const createAnonServerClient = client
export async function createServerSupabaseClient() {
  return client()
}
