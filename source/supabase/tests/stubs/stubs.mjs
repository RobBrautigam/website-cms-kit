// Shared state for the route stand-ins: each test sets what the fake
// services answer and reads back what the route did.
export const calls = {
  requireAdmin: 0,
  audit: [],
  regenerate: 0,
  anthropic: 0,
  passwords: [],
  /** Rate-limit buckets spent, in order. */
  limits: [],
  /** Every table operation: { table, op, payload, filters }. */
  queries: [],
  /** Every rpc: { name, args }. */
  rpc: [],
  /** Recovery codes looked up. */
  recoveryLookups: 0,
  /** Storage copies and the publish rpc, in the order they ran. */
  order: [],
}

export const fakes = {
  /** What consumeAiCall resolves to (true, false, or retry seconds); an Error is thrown instead. */
  aiAllowed: true,
  /** The model's text reply. */
  modelText: '[]',
  /** Two in-memory buckets for the storage stand-in. */
  storage: { staged: new Set(), public: new Set(), failCopy: null, refuseRemove: [] },
  /** consumeRateLimit answers per bucket (default true); an Error is thrown instead. */
  limits: {},
  /** In-memory tables for the query-builder stand-in: name -> rows. */
  tables: {},
  /** Tables whose next insert fails with this message. */
  failInsert: {},
  failSelect: {},
  /** rpc answers by name: a function of the args returning { data, error }. */
  rpc: {},
  /** The recovery-code row id findUnusedRecoveryCodeId returns (null: no match). */
  recoveryCode: null,
  /** Per table: a function run once on the rows just before the next update (a concurrent write). */
  beforeUpdate: {},
  /** The request headers next/headers answers with: a plain object. */
  headers: {},
}

export function resetStubs() {
  calls.requireAdmin = 0
  calls.audit = []
  calls.regenerate = 0
  calls.anthropic = 0
  calls.passwords = []
  calls.limits = []
  calls.queries = []
  calls.rpc = []
  calls.recoveryLookups = 0
  calls.order = []
  fakes.aiAllowed = true
  fakes.modelText = '[]'
  fakes.modelError = null
  fakes.storage = { staged: new Set(), public: new Set(), failCopy: null, refuseRemove: [] }
  fakes.limits = {}
  fakes.tables = {}
  fakes.failInsert = {}
  fakes.failSelect = {}
  fakes.rpc = {}
  fakes.recoveryCode = null
  fakes.beforeUpdate = {}
  fakes.headers = {}
}
