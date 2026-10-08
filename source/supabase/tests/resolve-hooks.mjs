// Module resolution for the tests, so the kit's TypeScript modules load under
// plain Node (22.18+ strips the types) exactly as they are written for Next.js:
//   - `@/x/y` resolves to source/x/y.ts (the app's path alias);
//   - extensionless relative imports inside source/ get `.ts`;
//   - packages a source module imports (zod) resolve from this folder's
//     node_modules;
//   - the framework and server-only modules a route handler imports resolve
//     to the small stand-ins in ./stubs/, so a route's own logic runs with no
//     Next.js server, no Supabase project and no network.
// Loaded by register.mjs (`node --import ./register.mjs --test ...`).
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = new URL('../../', import.meta.url)
const TESTS = new URL('./', import.meta.url)
const STUBS = new URL('./stubs/', import.meta.url)

const STUBBED = {
  'server-only': 'empty.mjs',
  'next/server': 'next-server.mjs',
  'next/headers': 'next-headers.mjs',
  'next/navigation': 'next-navigation.mjs',
  '@anthropic-ai/sdk': 'anthropic.mjs',
  '@supabase/supabase-js': 'supabase-js.mjs',
  '@/lib/auth/require': 'require.mjs',
  '@/lib/auth/audit': 'audit.mjs',
  '@/lib/auth/mfa': 'mfa.mjs',
  '@/lib/auth/reauth': 'reauth.mjs',
  '@/lib/supabase/server': 'supabase-server.mjs',
  '@/lib/security/rate-limit-db': 'rate-limit-db.mjs',
}

function withTs(url) {
  for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
    const candidate = new URL(url.href + suffix)
    if (suffix === '' && !/\.[cm]?[jt]sx?$/.test(url.pathname)) continue
    if (existsSync(fileURLToPath(candidate))) return candidate.href
  }
  return null
}

export async function resolve(specifier, context, next) {
  if (STUBBED[specifier]) {
    return { url: new URL(STUBBED[specifier], STUBS).href, shortCircuit: true }
  }
  const fromSource = context.parentURL?.startsWith(SOURCE.href) && !context.parentURL.startsWith(TESTS.href)
  if (specifier.startsWith('@/')) {
    const url = withTs(new URL(specifier.slice(2), SOURCE))
    if (url) return { url, shortCircuit: true }
  }
  if (fromSource && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    const url = withTs(new URL(specifier, context.parentURL))
    if (url) return { url, shortCircuit: true }
  }
  try {
    return await next(specifier, context)
  } catch (e) {
    if (fromSource && !specifier.startsWith('.') && !specifier.startsWith('node:')) {
      return next(specifier, { ...context, parentURL: TESTS.href })
    }
    throw e
  }
}
