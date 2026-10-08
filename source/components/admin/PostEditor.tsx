'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { createClient } from '@/lib/supabase/client'
import { IMAGE_ACCEPT, uploadBlogImage } from '@/lib/admin/upload-image'
import { getWordCount } from '@/lib/utils'

interface PostEditorProps {
  content: Record<string, unknown>
  onChange: (content: Record<string, unknown>) => void
}

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
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

      const result = await uploadBlogImage(createClient(), file)
      if ('error' in result) {
        alert(result.error)
        return
      }

      editor?.chain().focus().setImage({ src: result.url }).run()
    }
    input.click()
  }

  function addLink() {
    const url = prompt('Enter URL:')?.trim()
    if (!url) return
    // Same allowlist as TipTapRenderer: web, mail, phone, on-site paths and
    // anchors. Anything else (javascript:, data:) is refused at entry too.
    if (!/^(https?:|mailto:|tel:|\/|#)/i.test(url)) {
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
      <div className="w-px bg-border mx-1" />
      <button type="button" onClick={addLink} className={btnClass(editor?.isActive('link') || false)}>
        Link
      </button>
      <button type="button" onClick={addImage} className={btnClass(false)}>
        Image
      </button>
    </div>
  )
}

export default function PostEditor({ content, onChange }: PostEditorProps) {
  const editor = useEditor({
    // Render on the client only; rendering during SSR causes a hydration
    // mismatch in the App Router (TipTap's documented Next.js setting).
    immediatelyRender: false,
    extensions: [
      // TipTap 3's StarterKit already bundles Link (and Underline), so Link is
      // configured here rather than registered a second time.
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false },
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

  const wordCount = editor ? getWordCount(editor.getJSON() as Record<string, unknown>) : 0
  const readingTime = Math.max(1, Math.ceil(wordCount / 238))

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-bg-white">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
      <div className="px-4 py-2 border-t border-border text-xs text-text-secondary flex gap-4 bg-bg-card/30">
        <span>{wordCount.toLocaleString()} words</span>
        <span>{readingTime} min read</span>
      </div>
    </div>
  )
}
