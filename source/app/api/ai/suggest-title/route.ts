import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/auth/require'

const client = new Anthropic()

export async function POST(request: NextRequest) {
  // Admin-only: /api/* is not covered by the proxy, so gate here before any
  // paid call. Outside the try so the redirect-throw isn't caught as a 500.
  await requireAdmin()
  try {
    const { excerpt, currentTitle } = await request.json()

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: 'You are a headline writer for a blog. Write sharp, confident, benefit-driven blog titles. No clickbait, no vague hype. Return a JSON array of 3 title suggestions. Return ONLY the JSON array, no other text.',
      messages: [{
        role: 'user',
        content: `Suggest 3 alternative titles for a blog post.\n\nCurrent title: ${currentTitle || 'untitled'}\nExcerpt: ${excerpt || 'no excerpt'}`
      }],
    })

    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No content generated' }, { status: 500 })
    }

    let jsonStr = textContent.text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const titles = JSON.parse(jsonStr)
    return NextResponse.json({ titles })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
