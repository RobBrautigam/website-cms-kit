// Private staged images: which files a post uses, and the preview's swap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imagePathFromUrl, imagePathsIn, isImagePath, stagedImageFallback, withSignedImages } from './images.ts'

const BASE = 'https://proj.supabase.co/storage/v1/object/public/blog-images/'
const A = 'blog/0a1b2c3d4e5f.png'
const B = 'blog/11112222-3333-4444-5555-666677778888.webp'

test('only the kit\'s own public image URLs map to a storage path', () => {
  assert.equal(imagePathFromUrl(BASE + A), A)
  assert.equal(imagePathFromUrl(BASE + A + '?v=2'), A)
  assert.equal(imagePathFromUrl('https://elsewhere.example/cat.png'), null)
  assert.equal(imagePathFromUrl(BASE + 'blog/../../secret.png'), null)
  assert.equal(imagePathFromUrl(BASE.replace('public', 'sign') + A), null)
  assert.equal(imagePathFromUrl(42), null)
  assert.equal(isImagePath(A), true)
  assert.equal(isImagePath('blog/../x.png'), false)
  assert.equal(isImagePath('other/abcdefgh.png'), false)
})

test('a post\'s images: the featured image and every body image, each once', () => {
  const body = { type: 'doc', content: [
    { type: 'image', attrs: { src: BASE + A } },
    { type: 'blockquote', content: [{ type: 'image', attrs: { src: BASE + B } }] },
    { type: 'image', attrs: { src: 'https://elsewhere.example/c.png' } },
  ] }
  assert.deepEqual(imagePathsIn({ featured_image_url: BASE + A, body }).sort(), [A, B].sort())
  assert.deepEqual(imagePathsIn({ featured_image_url: null, body: null }), [])
})

test('the preview swaps staged images for signed links without touching the stored content', () => {
  const content = { featured_image_url: BASE + A, body: { type: 'doc', content: [{ type: 'image', attrs: { src: BASE + B, alt: 'x' } }] } }
  const before = JSON.stringify(content)
  const out = withSignedImages(content, { [A]: 'https://signed/a', [B]: 'https://signed/b' })
  assert.equal(out.featured_image_url, 'https://signed/a')
  assert.equal(out.body.content[0].attrs.src, 'https://signed/b')
  assert.equal(out.body.content[0].attrs.alt, 'x')
  assert.equal(JSON.stringify(content), before)
  assert.equal(withSignedImages(content, {}).featured_image_url, BASE + A)
})

test('the admin screens fall back to the signed-link route for a staged image', () => {
  assert.equal(stagedImageFallback(BASE + A), `/api/admin/staged-image?path=${encodeURIComponent(A)}`)
  assert.equal(stagedImageFallback('https://elsewhere.example/c.png'), null)
})
