import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Metadata } from 'next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { requireAdmin } from '@/lib/auth/require'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Help — Acme Admin',
  robots: { index: false, follow: false },
}

const GUIDE_PATH = path.join(process.cwd(), 'docs', 'admin-team-guide.md')
const FALLBACK_MARKDOWN =
  '# Help content coming soon\n\nThe admin team guide is being written. Please contact your administrator at support@example.com if you need help right now.'

async function loadGuide(): Promise<string> {
  try {
    const content = await readFile(GUIDE_PATH, 'utf-8')
    return content.trim() ? content : FALLBACK_MARKDOWN
  } catch (err) {
    console.error('[admin/help] failed to read guide', err)
    return FALLBACK_MARKDOWN
  }
}

export default async function HelpPage() {
  await requireAdmin()
  const markdown = await loadGuide()

  return (
    <article className="max-w-3xl mx-auto py-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ ...props }) => (
            <h1
              className="text-3xl font-black uppercase tracking-tight text-text-primary mb-6"
              style={{
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.04em',
              }}
              {...props}
            />
          ),
          h2: ({ ...props }) => (
            <h2
              className="text-xl font-black uppercase tracking-tight text-text-primary mt-12 mb-4 pb-2 border-b border-border"
              style={{
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.03em',
              }}
              {...props}
            />
          ),
          h3: ({ ...props }) => (
            <h3
              className="text-base font-bold text-text-primary mt-6 mb-2"
              {...props}
            />
          ),
          p: ({ ...props }) => (
            <p className="text-sm leading-relaxed text-text-primary mb-4" {...props} />
          ),
          ul: ({ ...props }) => (
            <ul className="text-sm leading-relaxed text-text-primary list-disc list-outside ml-5 mb-4 space-y-1.5" {...props} />
          ),
          ol: ({ ...props }) => (
            <ol className="text-sm leading-relaxed text-text-primary list-decimal list-outside ml-5 mb-4 space-y-1.5" {...props} />
          ),
          li: ({ ...props }) => <li className="pl-1" {...props} />,
          code: ({ ...props }) => (
            <code
              className="px-1.5 py-0.5 rounded bg-bg-elevated text-text-primary font-mono text-[0.85em]"
              {...props}
            />
          ),
          pre: ({ ...props }) => (
            <pre
              className="my-4 p-4 rounded-lg bg-bg-elevated text-text-primary font-mono text-xs overflow-x-auto"
              {...props}
            />
          ),
          a: ({ ...props }) => (
            <a className="text-accent underline underline-offset-2 hover:opacity-80" {...props} />
          ),
          blockquote: ({ ...props }) => (
            <blockquote
              className="border-l-4 border-border pl-4 my-4 text-text-secondary italic"
              {...props}
            />
          ),
          table: ({ ...props }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse border border-border text-sm" {...props} />
            </div>
          ),
          th: ({ ...props }) => (
            <th
              className="border border-border bg-bg-elevated px-3 py-2 text-left font-semibold text-text-primary"
              {...props}
            />
          ),
          td: ({ ...props }) => (
            <td className="border border-border px-3 py-2 text-text-primary align-top" {...props} />
          ),
          hr: ({ ...props }) => <hr className="my-8 border-border" {...props} />,
          strong: ({ ...props }) => (
            <strong className="font-bold text-text-primary" {...props} />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  )
}
