import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * The check for routes a scheduler calls (1.5.0): no cookie, no session, only
 * `Authorization: Bearer <CRON_SECRET>`. Refuses with 503 while the secret is
 * unset or shorter than 32 characters (the job is not set up), and 401 for a
 * missing or wrong token. Both sides are hashed first, so the comparison
 * takes the same time whatever the token's length.
 */
export const CRON_SECRET_MIN_LENGTH = 32

export function cronRefusal(request: Request): Response | null {
  const secret = process.env.CRON_SECRET ?? ''
  if (secret.length < CRON_SECRET_MIN_LENGTH) {
    return Response.json({ error: 'The scheduled job is not set up (CRON_SECRET).' }, { status: 503 })
  }
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')
  const digest = (s: string) => createHash('sha256').update(s).digest()
  if (!match || !timingSafeEqual(digest(match[1]), digest(secret))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
