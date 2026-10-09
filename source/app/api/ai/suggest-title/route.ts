import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/auth/require'
import { crossSiteRefusal } from '@/lib/security/request-origin'
import { aiLimitRefusal } from '@/lib/security/rate-limit'
import { consumeAiCall } from '@/lib/security/rate-limit-db'
import { beginAiSpend } from '@/lib/ai/spend'
import { TitleInput, TitleSuggestions, parseModelJson } from '@/lib/ai/schemas'

const client = new Anthropic()
const MODEL = 'claude-sonnet-4-20250514'

export async function POST(request: NextRequest) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  // Admin-only: /api/* is not covered by the proxy, so gate here before any
  // paid call. Outside the try so the redirect-throw isn't caught as a 500.
  const { user } = await requireAdmin()
  // The body first: a malformed request is refused before any budget is spent.
  const input = TitleInput.safeParse(await request.json().catch(() => null))
  if (!input.success) {
    return NextResponse.json({ error: 'Send an excerpt (up to 2,000 characters) and the current title.' }, { status: 400 })
  }
  const { excerpt, currentTitle } = input.data
  const limited = await aiLimitRefusal(() => consumeAiCall(user.id))
  if (limited) return limited
  // No spend record, no call (lib/ai/spend.ts).
  const spend = await beginAiSpend(user.id, 'ai/suggest-title', MODEL)
  if (spend instanceof Response) return spend
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: 'You are a headline writer for a blog. Write sharp, confident, benefit-driven blog titles. No clickbait, no vague hype. Return a JSON array of 3 title suggestions. Return ONLY the JSON array, no other text.',
      messages: [{
        role: 'user',
        content: `Suggest 3 alternative titles for a blog post.\n\nCurrent title: ${currentTitle || 'untitled'}\nExcerpt: ${excerpt || 'no excerpt'}`
      }],
    })
    await spend.settle(message.usage)

    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No content generated' }, { status: 502 })
    }

    // Model text is untrusted: only the promised shape reaches the editor.
    const parsed = parseModelJson(textContent.text, TitleSuggestions)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 502 })
    return NextResponse.json({ titles: parsed.data })
  } catch (e) {
    await spend.failed(e)
    console.error('AI title error:', e)
    return NextResponse.json({ error: 'The AI request failed.' }, { status: 500 })
  }
}
