'use client'

import { stagedImageFallback } from '@/lib/staging/images'

/**
 * An <img> for the admin screens that can show an image which is not public
 * yet: when its final URL does not load, it switches once to the admin's
 * signed-link route (lib/staging/images.ts).
 */
export default function AdminImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img
      {...props}
      onError={(e) => {
        const img = e.currentTarget
        if (img.dataset.stagedFallback) return
        const fallback = stagedImageFallback(img.getAttribute('src'))
        if (!fallback) return
        img.dataset.stagedFallback = '1'
        img.src = fallback
      }}
    />
  )
}
