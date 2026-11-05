import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef } from 'react'
import { agentFor } from '../lib/agent'
import { openFile } from '../lib/actions'
import { copyText } from '../lib/bridge'
import { toast } from '../lib/dialogs'
import { dirname, isAbsolute, join, normalize } from '../lib/paths'
import * as S from '../lib/store'
import { bytesOf, imageType, type Preview as Kind } from '../lib/viewers'
import { ImageView, useBlobUrl } from './ViewerPane'

const external = /^[a-z][a-z0-9+.-]*:/i

function resolveLink(base: string, href: string): string {
  const clean = decodeURIComponent(href.split(/[?#]/)[0])
  return normalize(isAbsolute(clean) ? clean : join(dirname(base), clean))
}

function MarkdownPreview({ text, path }: { text: string; path: string }) {
  const project = S.useProjectId()
  const box = useRef<HTMLDivElement>(null)
  const html = useMemo(() => {
    // Relative images are read from the project (see below), so they mustn't load from the app's own address first.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      const src = node.tagName === 'IMG' ? (node.getAttribute('src') ?? '') : ''
      if (src && !external.test(src) && !src.startsWith('//')) {
        node.setAttribute('data-src', src)
        node.removeAttribute('src')
      }
    })
    try {
      return DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }))
    } finally {
      DOMPurify.removeHook('afterSanitizeAttributes')
    }
  }, [text])

  const images = useRef(new Map<string, Promise<string | null>>())
  useEffect(() => {
    const cache = images.current
    return () => {
      for (const u of cache.values()) u.then((url) => url && URL.revokeObjectURL(url))
      cache.clear()
    }
  }, [project])

  useEffect(() => {
    for (const img of box.current?.querySelectorAll<HTMLImageElement>('img[data-src]') ?? []) {
      const file = resolveLink(path, img.dataset.src!)
      let url = images.current.get(file)
      if (!url) {
        url = agentFor(project)
          .readBytes(file)
          .then((r) => (r.tooLarge ? null : URL.createObjectURL(new Blob([bytesOf(r.data)], { type: imageType(file) }))))
          .catch(() => null)
        images.current.set(file, url)
      }
      url.then((u) => {
        if (u && img.isConnected) img.src = u
      })
    }
  }, [html, path, project])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as Element).closest('a')
    const href = a?.getAttribute('href')
    if (!a || !href) return
    e.preventDefault()
    if (href.startsWith('#')) {
      const id = decodeURIComponent(href.slice(1))
      box.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' })
    } else if (external.test(href)) {
      copyText(href)
      toast(`Copied the link: ${href}`)
    } else openFile(resolveLink(path, href))
  }

  return <div className="markdown" ref={box} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

function SvgPreview({ id, text }: { id: string; text: string }) {
  const url = useBlobUrl(() => new Blob([text], { type: 'image/svg+xml' }), [text])
  return url ? <ImageView id={`${id}:svg`} active={false} url={url} status={false} vector /> : null
}

/** A file's rendered form, shown beside its text. */
export default function Preview({ id, kind, text, path }: { id: string; kind: Kind; text: string; path: string }) {
  return <div className="file-preview">{kind === 'markdown' ? <MarkdownPreview text={text} path={path} /> : <SvgPreview id={id} text={text} />}</div>
}
