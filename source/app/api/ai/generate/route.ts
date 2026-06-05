// Optional: requires ANTHROPIC_API_KEY. An admin-only authenticated AI endpoint.
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireAdmin } from '@/lib/auth/require'

const client = new Anthropic()

const SYSTEM_PROMPT = `You are a helpful blog-writing assistant. Write clear, well-structured, SEO-aware blog posts on the given topic.

## Writing Style
- Clear, direct, and informative
- Short paragraphs (2-3 sentences max)
- Explain the problem, the solution, and the takeaway
- Avoid buzzwords ("just", "robust", "seamless", "cutting-edge") and vague filler
- Every section should answer: why does this matter, and what should the reader do about it

## Content Structure
- Title: compelling, benefit-driven, not clickbait
- 1200-1800 words
- Use H2 and H3 headings (NEVER H1 inside the body)
- Strong opening hook within the first paragraph
- End with a clear takeaway or call to action
- Weave SEO keywords naturally — never force them

## Output Format
You MUST return valid JSON with this exact structure:
{
  "title": "Post Title Here",
  "slug": "post-title-here",
  "excerpt": "A 1-2 sentence summary for blog cards (under 200 chars)",
  "metaDescription": "SEO meta description (under 160 chars)",
  "suggestedCategories": ["category-one", "category-two"],
  "body": <TipTap JSON document>
}

The body must be a TipTap-compatible JSON document with this structure:
{
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Heading text" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "Paragraph text" }] },
    { "type": "paragraph", "content": [
      { "type": "text", "text": "Normal text " },
      { "type": "text", "marks": [{ "type": "bold" }], "text": "bold text" },
      { "type": "text", "text": " more text" }
    ]},
    { "type": "bulletList", "content": [
      { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Item 1" }] }] }
    ]},
    { "type": "blockquote", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Quote text" }] }] }
  ]
}

Available categories: customize this list to match your site's taxonomy.

Return ONLY the JSON object, no markdown code fences or other text.`

export async function POST(request: NextRequest) {
  // Admin-only: gate BEFORE reading the body or calling Anthropic. The proxy
  // does NOT cover /api/*, so this server-side check is what stops anonymous
  // traffic from triggering paid generations. requireAdmin() throws a redirect
  // for unauthenticated callers (a 307 in a route handler) — keep it OUTSIDE the
  // try so the catch below doesn't swallow it into a 500.
  await requireAdmin()
  try {
    const { topic, keywords } = await request.json()

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    let userPrompt = `Write a blog post about: ${topic}`
    if (keywords && keywords.length > 0) {
      userPrompt += `\n\nTarget SEO keywords: ${keywords.join(', ')}`
    }

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      messages: [{ role: 'user', content: userPrompt }],
      system: SYSTEM_PROMPT,
    })

    const textContent = message.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'No content generated' }, { status: 500 })
    }

    // Parse the JSON response
    let parsed
    try {
      // Strip markdown code fences if present
      let jsonStr = textContent.text.trim()
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      parsed = JSON.parse(jsonStr)
    } catch {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (e) {
    console.error('AI generation error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Generation failed' },
      { status: 500 }
    )
  }
}
