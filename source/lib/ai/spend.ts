import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * The spend record for the optional AI routes (the ai_usage table, migration
 * 003, section 22). A row is written BEFORE the model is called and settled
 * with the token counts when the reply arrives, so a call that dies halfway
 * still shows as spent ('started', counts unknown). No record, no call: if
 * the row cannot be written the route refuses (503), the same way a limiter
 * that is down pauses AI calls.
 *
 * The table is closed to the public and authenticated keys; only the
 * service role writes it, and the super admin reads it in SQL (docs/09).
 */
export type AiSpend = {
  settle(usage: { input_tokens?: number | null; output_tokens?: number | null } | null | undefined): Promise<void>
  /** After a failed call: an API refusal (4xx) is not billed and is marked
   *  'refused'; a timeout, a dropped connection or a 5xx may have been billed
   *  and stays 'started'. */
  failed(error: unknown): Promise<void>
}

export async function beginAiSpend(userId: string, route: string, model: string): Promise<AiSpend | Response> {
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('ai_usage')
    .insert({ user_id: userId, route, model, status: 'started' })
    .select('id')
    .single()
  if (error || !data) {
    return Response.json(
      { error: 'The AI spend record is unavailable, so AI calls are paused. Check that migration 003 has run.' },
      { status: 503 }
    )
  }
  const id = (data as { id: string }).id
  return {
    async settle(usage) {
      const { error: settleError } = await svc
        .from('ai_usage')
        .update({
          status: 'ok',
          input_tokens: usage?.input_tokens ?? null,
          output_tokens: usage?.output_tokens ?? null,
          settled_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (settleError) console.error('ai_usage: settle failed', settleError.message)
    },
    async failed(error) {
      const status = (error as { status?: unknown } | null)?.status
      if (typeof status !== 'number' || status < 400 || status >= 500) return
      const { error: refuseError } = await svc
        .from('ai_usage')
        .update({ status: 'refused', settled_at: new Date().toISOString() })
        .eq('id', id)
      if (refuseError) console.error('ai_usage: refuse failed', refuseError.message)
    },
  }
}
