import { extname } from './paths'

export type Viewer = 'image' | 'sheet' | 'slides'
export type Preview = 'markdown' | 'svg'

const images: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
}

/** The read-only viewer for files that aren't text. */
export function viewerFor(path: string | null): Viewer | null {
  const ext = path ? extname(path) : ''
  if (ext in images) return 'image'
  if (ext === 'xlsx' || ext === 'xlsm') return 'sheet'
  if (ext === 'pptx') return 'slides'
  return null
}

/** Text files that are also shown rendered, beside their text. */
export function previewFor(path: string | null): Preview | null {
  const ext = path ? extname(path) : ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'svg') return 'svg'
  return null
}

export function imageType(path: string): string {
  return images[extname(path)] ?? 'application/octet-stream'
}

export function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i)
  return out
}

export function sizeText(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
