import { requireAdmin } from '@/lib/auth/require'
import { loadMediaLibrary } from '@/lib/media/load'
import { REVIEW_REQUIRED } from '@/lib/staging/rules'
import MediaLibraryView from './MediaLibraryView'

export const dynamic = 'force-dynamic'

export default async function MediaPage() {
  await requireAdmin()
  const result = await loadMediaLibrary()

  return (
    <>
      <h1 className="text-2xl font-black mb-2" style={{ fontFamily: 'var(--font-display)' }}>
        MEDIA
      </h1>
      <p className="text-sm text-text-secondary mb-8 max-w-2xl">
        Every image the site holds. New uploads stay private until the post using them goes live; pick an image
        here or from the editor to use it again without uploading it twice. An image a post, a staged change, a
        kept revision or a testimonial still uses cannot be deleted.
      </p>
      {'error' in result ? (
        <p role="alert" className="text-sm text-red-600">
          {result.error}
        </p>
      ) : (
        <MediaLibraryView assets={result.assets} reviewRequired={REVIEW_REQUIRED} />
      )}
    </>
  )
}
