import type { NextConfig } from 'next'
import { SECURITY_HEADERS } from './lib/security/headers'

/**
 * The kit's Next.js config. Merge it into yours if you already have one.
 *
 * The fixed security headers go on every response here; the Content
 * Security Policy carries a per-request nonce, so proxy.ts sets it (see
 * lib/security/headers.ts for both halves and how to switch the policy from
 * report-only to enforced).
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default nextConfig
