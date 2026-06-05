'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ImageUploaderProps {
  currentUrl?: string
  onUpload: (url: string) => void
  label?: string
}

export default function ImageUploader({ currentUrl, onUpload, label = 'Featured Image' }: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(currentUrl || '')
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)

    const ext = file.name.split('.').pop()
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const filePath = `blog/${fileName}`

    const { error } = await supabase.storage
      .from('blog-images')
      .upload(filePath, file, { cacheControl: '31536000', upsert: false })

    if (error) {
      alert('Upload failed: ' + error.message)
      setUploading(false)
      return
    }

    const { data: { publicUrl } } = supabase.storage
      .from('blog-images')
      .getPublicUrl(filePath)

    setPreview(publicUrl)
    onUpload(publicUrl)
    setUploading(false)
  }

  function handleRemove() {
    setPreview('')
    onUpload('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-text-secondary mb-1.5">{label}</label>
      {preview ? (
        <div className="relative rounded-lg overflow-hidden border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Preview" className="w-full aspect-[16/9] object-cover" />
          <button
            onClick={handleRemove}
            className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded hover:bg-black/80 transition"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full aspect-[16/9] border-2 border-dashed border-border rounded-lg flex items-center justify-center text-text-secondary hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Click to upload image'}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  )
}
