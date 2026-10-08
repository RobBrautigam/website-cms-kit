import { z } from 'zod'
import { RENDERED_MARKS, RENDERED_NODES } from '@/lib/tiptap/schema'

/**
 * Schemas for what goes into and comes out of the AI routes.
 *
 * Inputs are capped so one request cannot buy an outsized prompt. Outputs
 * are checked before they reach the editor: model text is untrusted, so a
 * reply that is not the promised shape is a 502, never passed through. The
 * body may hold only node and mark types the public renderer draws.
 */

export const TitleInput = z.object({
  excerpt: z.string().max(2000).optional().default(''),
  currentTitle: z.string().max(300).optional().default(''),
})

export const MetaInput = z.object({
  title: z.string().min(1).max(300),
  excerpt: z.string().max(2000).optional().default(''),
})

export const GenerateInput = z.object({
  topic: z.string().trim().min(1, 'Topic is required').max(500),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional().default([]),
})

export const TitleSuggestions = z.array(z.string().trim().min(1).max(200)).min(1).max(5)

export const MetaSuggestion = z.object({
  metaDescription: z.string().trim().min(1).max(320),
})

const Mark = z.object({
  type: z.enum(RENDERED_MARKS),
  attrs: z.record(z.string(), z.unknown()).optional(),
})

type Node = {
  type: (typeof RENDERED_NODES)[number]
  attrs?: Record<string, unknown>
  content?: Node[]
  text?: string
  marks?: z.infer<typeof Mark>[]
}

const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({
    type: z.enum(RENDERED_NODES),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(NodeSchema).max(2000).optional(),
    text: z.string().max(20000).optional(),
    marks: z.array(Mark).max(10).optional(),
  })
)

export const TipTapDoc = z.object({
  type: z.literal('doc'),
  content: z.array(NodeSchema).max(2000),
})

export const GeneratedPost = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200),
  excerpt: z.string().max(500),
  metaDescription: z.string().max(320),
  suggestedCategories: z.array(z.string().max(80)).max(10).default([]),
  body: TipTapDoc,
})

export type ModelResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * The model's text reply, as JSON of the given shape. Strips one Markdown
 * code fence if the model added one anyway.
 */
export function parseModelJson<T>(text: string, schema: z.ZodType<T>): ModelResult<T> {
  let raw = text.trim()
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'The AI reply was not valid JSON.' }
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) return { ok: false, error: 'The AI reply did not have the expected shape.' }
  return { ok: true, data: parsed.data }
}
