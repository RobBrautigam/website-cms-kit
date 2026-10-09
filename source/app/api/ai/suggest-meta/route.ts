import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/auth/require'
import { crossSiteRefusal } from '@/lib/security/request-origin'
import { aiLimitRefusal } from '@/lib/security/rate-limit'
import { consumeAiCall } from '@/lib/security/rate-limit-db'
import { MetaInput, MetaSuggestion, parseModelJson } from '@/lib/ai/schemas'

const client = new Anthropic()

export async function POST(request: NextRequest) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  // Admin-only: /api/* is not covered by the proxy, so gate here before any
  // paid call. Outside the try so the redirect-throw isn't caught as a 500.
  const { user } = await requireAdmin()
  const limited = await aiLimitRefusal(() => consumeAiCall(user.id))
  if (limited) return limited
  try {
    const input = MetaInput.safeParse(await request.json().catch(() => null))
    if (!input.success) {
      return NextResponse.json({ error: 'Send a title (up to 300 characters) and an excerpt (up to 2,000).' }, { status: 400 })
    }
    const { title, excerpt } = input.data

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: 'You write SEO meta descriptions for blog posts. Keep it under 155 characters, compelling, and action-oriented. Return a JSON object: { "metaDescription": "..." }. Return ONLY the JSON, no other text.',
      messages: [{
        role: 'user',
        content: `Write a meta description for:\nTitle: ${title}\nExcerpt: ${excerpt || 'no excerpt'}`
      }],
    })

    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No content generated' }, { status: 502 })
    }

    // Model text is untrusted: only the promised shape reaches the editor.
    const parsed = parseModelJson(textContent.text, MetaSuggestion)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 502 })
    return NextResponse.json(parsed.data)
  } catch (e) {
    console.error('AI meta error:', e)
    return NextResponse.json({ error: 'The AI request failed.' }, { status: 500 })
  }
}
