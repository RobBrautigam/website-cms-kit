'use client'

import React from 'react'
import Image from 'next/image'

interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  marks?: TipTapMark[]
  attrs?: Record<string, unknown>
}

interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}

function plainText(node: TipTapNode): string {
  if (node.type === 'text') return node.text || ''
  return (node.content || []).map(plainText).join('')
}

const TAKEAWAYS_RE = /^key takeaways$/i

function renderDocChildren(nodes: TipTapNode[]): React.ReactNode {
  const firstHeadingIndex = nodes.findIndex((n) => n.type === 'heading')
  const out: React.ReactNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    // Lede: paragraphs before the first heading get the standfirst treatment.
    if (
      node.type === 'paragraph' &&
      firstHeadingIndex !== -1 &&
      i < firstHeadingIndex
    ) {
      out.push(
        <p
          key={i}
          className="tiptap-lede text-xl md:text-2xl leading-[1.6] text-text-primary mb-8"
        >
          {node.content?.map((c, ci) => renderNode(c, ci))}
        </p>,
      )
      continue
    }
    // Key Takeaways card: H2 "Key Takeaways" + following bulletList.
    if (
      node.type === 'heading' &&
      (node.attrs?.level as number) === 2 &&
      TAKEAWAYS_RE.test(plainText(node).trim()) &&
      nodes[i + 1]?.type === 'bulletList'
    ) {
      const list = nodes[i + 1]
      out.push(
        <aside
          key={i}
          data-tiptap-takeaways
          className="my-10 rounded-2xl border border-accent/30 bg-accent/5 p-6 md:p-8"
        >
          <h2 className="heading-display text-2xl mb-4">Key Takeaways</h2>
          {renderNode(list, i + 1)}
        </aside>,
      )
      i += 1 // consume the list
      continue
    }
    out.push(<React.Fragment key={i}>{renderNode(node, i)}</React.Fragment>)
  }
  return out
}

function renderMarks(text: string, marks?: TipTapMark[]): React.ReactNode {
  if (!marks || marks.length === 0) return text

  return marks.reduce<React.ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong className="font-bold text-text-primary">{acc}</strong>
      case 'italic':
        return <em>{acc}</em>
      case 'link': {
        const raw = (mark.attrs?.href as string) || ''
        // Scheme allowlist: block javascript:/data:/vbscript: URIs (stored XSS).
        // Body JSON can come from model output or an import, so never trust href.
        const href = /^(https?:|mailto:|tel:|\/|#)/i.test(raw) ? raw : '#'
        const isExternal = href.startsWith('http')
        return (
          <a
            href={href}
            className="text-accent hover:underline"
            {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {acc}
          </a>
        )
      }
      default:
        return acc
    }
  }, text)
}

function renderNode(node: TipTapNode, index: number): React.ReactNode {
  if (node.type === 'text') {
    return <React.Fragment key={index}>{renderMarks(node.text || '', node.marks)}</React.Fragment>
  }

  const children = node.content?.map((child, i) => renderNode(child, i))

  switch (node.type) {
    case 'heading': {
      const level = (node.attrs?.level as number) || 2
      if (level === 1)
        return <h1 key={index} className="heading-display text-4xl mt-12 mb-6">{children}</h1>
      if (level === 2)
        return <h2 key={index} className="heading-display text-3xl mt-10 mb-5">{children}</h2>
      return <h3 key={index} className="heading-display text-2xl mt-8 mb-4">{children}</h3>
    }
    case 'paragraph':
      return <p key={index} className="text-text-secondary text-[17px] leading-[1.8] mb-6">{children}</p>
    case 'blockquote':
      return (
        <blockquote key={index} className="border-l-4 border-accent pl-6 my-8 italic text-text-secondary text-lg">
          {children}
        </blockquote>
      )
    case 'bulletList':
      return <ul key={index} className="list-disc pl-6 mb-6 space-y-2 text-text-secondary text-[17px]">{children}</ul>
    case 'orderedList':
      return <ol key={index} className="list-decimal pl-6 mb-6 space-y-2 text-text-secondary text-[17px]">{children}</ol>
    case 'listItem':
      return <li key={index} className="leading-[1.7]">{children}</li>
    case 'image': {
      const src = node.attrs?.src as string
      const alt = (node.attrs?.alt as string) || ''
      const caption = node.attrs?.title as string | undefined
      // Only allow http(s) or root-relative image sources (block data:/javascript:).
      if (!src || !/^(https?:|\/)/i.test(src)) return null
      return (
        <figure key={index} className="my-10">
          <Image
            src={src}
            alt={alt}
            width={1536}
            height={1024}
            sizes="(max-width: 720px) 100vw, 720px"
            className="w-full h-auto rounded-xl"
          />
          {caption && (
            <figcaption className="text-center text-sm text-text-secondary mt-3">{caption}</figcaption>
          )}
        </figure>
      )
    }
    case 'table': {
      const rows = node.content || []
      const [headRow, ...bodyRows] = rows
      return (
        <div
          key={index}
          className="my-8 overflow-x-auto rounded-xl border border-border"
        >
          <table className="w-full border-collapse text-left text-[15px]">
            {headRow && <thead>{renderNode(headRow, 0)}</thead>}
            <tbody>{bodyRows.map((r, i) => renderNode(r, i + 1))}</tbody>
          </table>
        </div>
      )
    }
    case 'tableRow':
      return (
        <tr key={index} className="border-b border-border last:border-0">
          {children}
        </tr>
      )
    case 'tableHeader':
      return (
        <th key={index} className="px-4 py-3 align-top font-bold text-text-primary">
          {children}
        </th>
      )
    case 'tableCell':
      return (
        <td key={index} className="px-4 py-3 align-top text-text-secondary">
          {children}
        </td>
      )
    case 'hardBreak':
      return <br key={index} />
    case 'doc':
      return <>{renderDocChildren(node.content || [])}</>
    default:
      return <React.Fragment key={index}>{children}</React.Fragment>
  }
}

export default function TipTapRenderer({ value }: { value: Record<string, unknown> }) {
  if (!value || !('type' in value)) return null
  return <>{renderNode(value as unknown as TipTapNode, 0)}</>
}
