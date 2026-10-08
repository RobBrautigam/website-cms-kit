// Shared state for the route stand-ins: each test sets what the fake
// services answer and reads back what the route did.
export const calls = {
  requireAdmin: 0,
  audit: [],
  regenerate: 0,
  anthropic: 0,
  passwords: [],
}

export const fakes = {
  /** What consumeAiCall resolves to; an Error is thrown instead. */
  aiAllowed: true,
  /** The model's text reply. */
  modelText: '[]',
  /** Two in-memory buckets for the storage stand-in. */
  storage: { staged: new Set(), public: new Set(), failCopy: null },
}

export function resetStubs() {
  calls.requireAdmin = 0
  calls.audit = []
  calls.regenerate = 0
  calls.anthropic = 0
  calls.passwords = []
  fakes.aiAllowed = true
  fakes.modelText = '[]'
  fakes.storage = { staged: new Set(), public: new Set(), failCopy: null }
}
