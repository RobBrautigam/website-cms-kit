'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { createClient } from '@/lib/supabase/client'
import { IMAGE_ACCEPT, uploadBlogImage } from '@/lib/admin/upload-image'
import { isSafeHref } from '@/lib/safe-href'
import { useEffect, useRef } from 'react'
import { getWordCount } from '@/lib/utils'
import { bodyImagesMissingAlt } from '@/lib/admin/alt-text'
import { stagedImageFallback } from '@/lib/staging/images'

interface PostEditorProps {
  content: Record<string, unknown>
  onChange: (content: Record<string, unknown>) => void
}

// Null until the editor mounts on the client (immediatelyRender: false).
function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null

  const btnClass = (active: boolean) =>
    `px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
      active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-bg-card'
    }`

  async function addImage() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMAGE_ACCEPT
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      try {
        const result = await uploadBlogImage(createClient(), file)
        if ('error' in result) {
          alert(result.error)
          return
        }
        // Alt text is required before the post goes live; ask for it now,
        // while the writer knows what the image shows.
        const alt = prompt('Describe this image for people who cannot see it (alt text):')?.trim() ?? ''
        editor?.chain().focus().setImage({ src: result.url, alt }).run()
      } catch {
        alert('Upload failed. Please try again.')
      }
    }
    input.click()
  }

  function editAlt() {
    const current = (editor?.getAttributes('image').alt as string | undefined) ?? ''
    const alt = prompt('Alt text for this image:', current)
    if (alt === null) return
    editor?.chain().focus().updateAttributes('image', { alt: alt.trim() }).run()
  }

  function addLink() {
    const url = prompt('Enter URL:')?.trim()
    if (!url) return
    // Same allowlist as TipTapRenderer: web, mail, phone, on-site paths and
    // anchors. Anything else (javascript:, data:, //host) is refused at entry too.
    if (!isSafeHref(url)) {
      alert('Links must start with https://, http://, mailto:, tel:, / or #.')
      return
    }
    editor?.chain().focus().setLink({ href: url }).run()
  }

  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-border bg-bg-card/50">
      <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} className={btnClass(editor?.isActive('heading', { level: 2 }) || false)}>
        H2
      </button>
      <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} className={btnClass(editor?.isActive('heading', { level: 3 }) || false)}>
        H3
      </button>
      <div className="w-px bg-border mx-1" />
      <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className={btnClass(editor?.isActive('bold') || false)}>
        <strong>B</strong>
      </button>
      <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className={btnClass(editor?.isActive('italic') || false)}>
        <em>I</em>
      </button>
      <button type="button" aria-label="Strikethrough" onClick={() => editor?.chain().focus().toggleStrike().run()} className={btnClass(editor?.isActive('strike') || false)}>
        <s>S</s>
      </button>
      <button type="button" aria-label="Inline code" onClick={() => editor?.chain().focus().toggleCode().run()} className={btnClass(editor?.isActive('code') || false)}>
        <code>{'<>'}</code>
      </button>
      <div className="w-px bg-border mx-1" />
      <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className={btnClass(editor?.isActive('bulletList') || false)}>
        List
      </button>
      <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={btnClass(editor?.isActive('orderedList') || false)}>
        1. List
      </button>
      <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={btnClass(editor?.isActive('blockquote') || false)}>
        Quote
      </button>
      <button type="button" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} className={btnClass(editor?.isActive('codeBlock') || false)}>
        Code
      </button>
      <button type="button" aria-label="Divider" onClick={() => editor?.chain().focus().setHorizontalRule().run()} className={btnClass(false)}>
        HR
      </button>
      <div className="w-px bg-border mx-1" />
      <button type="button" onClick={addLink} className={btnClass(editor?.isActive('link') || false)}>
        Link
      </button>
      <button type="button" onClick={addImage} className={btnClass(false)}>
        Image
      </button>
      {editor?.isActive('image') && (
        <button type="button" onClick={editAlt} className={btnClass(true)}>
          Alt text
        </button>
      )}
    </div>
  )
}

export default function PostEditor({ content, onChange }: PostEditorProps) {
  const editor = useEditor({
    // Render on the client only; rendering during SSR causes a hydration
    // mismatch in the App Router (TipTap's documented Next.js setting).
    immediatelyRender: false,
    // TipTap 3 no longer re-renders on every transaction by default; the
    // toolbar reads isActive() during render, so opt back in or its active
    // states go stale when only the selection moves.
    shouldRerenderOnTransaction: true,
    extensions: [
      // TipTap 3's StarterKit already bundles Link (and Underline), so Link is
      // configured here rather than registered a second time. Underline is
      // off: TipTapRenderer has no case for it, so Ctrl+U would show in the
      // editor and vanish on the site.
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false },
        underline: false,
      }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: 'Start writing your post...' }),
    ],
    content: content && Object.keys(content).length > 0 ? content : undefined,
    onUpdate: ({ editor }) => {
      onChange(editor.getJSON() as Record<string, unknown>)
    },
    editorProps: {
      attributes: {
        class: 'tiptap',
      },
    },
  })

  const json = editor ? (editor.getJSON() as Record<string, unknown>) : null
  const wordCount = json ? getWordCount(json) : 0
  const readingTime = Math.max(1, Math.ceil(wordCount / 238))
  const missingAlt = json ? bodyImagesMissingAlt(json) : 0

  // A new image is private until the post goes live, so its final URL does
  // not load yet. Show it through the admin's signed-link route instead. Only
  // the <img> element changes; ProseMirror ignores changes inside a leaf
  // node, so the stored URL stays the final one.
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    // 'error' does not bubble, so listen in the capture phase.
    const onError = (e: Event) => {
      const img = e.target
      if (!(img instanceof HTMLImageElement) || img.dataset.stagedFallback) return
      const fallback = stagedImageFallback(img.getAttribute('src'))
      if (!fallback) return
      img.dataset.stagedFallback = '1'
      img.src = fallback
    }
    el.addEventListener('error', onError, true)
    return () => el.removeEventListener('error', onError, true)
  }, [])

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-bg-white">
      <EditorToolbar editor={editor} />
      <div ref={contentRef}>
        <EditorContent editor={editor} />
      </div>
      <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex flex-wrap gap-4 bg-bg-card/30">
        <span>{wordCount.toLocaleString()} words</span>
        <span>{readingTime} min read</span>
        {missingAlt > 0 && (
          <span className="text-amber-700" role="status">
            {missingAlt === 1 ? '1 image needs' : `${missingAlt} images need`} alt text (select it, then Alt text)
          </span>
        )}
      </div>
    </div>
  )
}
