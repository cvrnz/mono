import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { agentFor } from '../lib/agent'
import { sidebarFocused } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { register } from '../lib/panes'
import { basename } from '../lib/paths'
import * as S from '../lib/store'
import { bytesOf, imageType, sizeText, viewerFor } from '../lib/viewers'
import { columnName, readWorkbook, type Sheet } from '../lib/xlsx'

type Props = { tab: S.FileTab; active: boolean }

function useStatus(id: string, items: string[]) {
  const key = items.join('\n')
  useEffect(() => S.setPaneStatus(id, { items: key ? key.split('\n') : [] }), [id, key])
  useEffect(
    () => () =>
      S.set((s) => {
        const status = { ...s.status }
        delete status[id]
        return { status }
      }),
    [id],
  )
}

function useFocus(id: string, active: boolean, el: React.RefObject<HTMLElement | null>, ready: boolean) {
  useEffect(() => register(id, { focus: () => el.current?.focus() }), [id, el])
  useEffect(() => {
    if (active && ready && !sidebarFocused()) el.current?.focus()
  }, [active, ready, el])
}

/** Opens a file that isn't text in a read-only viewer. */
export default function ViewerPane({ tab, active }: Props) {
  const project = S.useProjectId()
  const [data, setData] = useState<{ bytes: Uint8Array<ArrayBuffer>; size: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const path = tab.path!
  const kind = viewerFor(path)

  useEffect(() => {
    let live = true
    setData(null)
    setNote(null)
    agentFor(project)
      .readBytes(path)
      .then((r) => {
        if (!live) return
        if (r.tooLarge) setNote(`${basename(path)} is too large to show (${sizeText(r.size)}).`)
        else setData({ bytes: bytesOf(r.data), size: r.size })
      })
      .catch((err) => live && setNote(errorText(err)))
    return () => {
      live = false
    }
  }, [project, path])

  if (note || !data) return <NoteView id={tab.id} active={active} text={note ?? `Opening ${basename(path)}…`} />
  if (kind === 'image') return <BytesImage tab={tab} active={active} bytes={data.bytes} size={data.size} />
  if (kind === 'sheet') return <SheetView tab={tab} active={active} bytes={data.bytes} />
  return <SlidesView tab={tab} active={active} bytes={data.bytes} />
}

function NoteView({ id, active, text }: { id: string; active: boolean; text: string }) {
  const el = useRef<HTMLDivElement>(null)
  useFocus(id, active, el, true)
  useStatus(id, [])
  return (
    <div className="editor-note" tabIndex={0} ref={el}>
      {text}
    </div>
  )
}

/** A URL for a blob that lives as long as the component shows it. */
export function useBlobUrl(make: () => Blob, deps: unknown[]): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(make())
    setUrl(u)
    return () => URL.revokeObjectURL(u)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return url
}

function BytesImage({ tab, active, bytes, size }: Props & { bytes: Uint8Array<ArrayBuffer>; size: number }) {
  const url = useBlobUrl(() => new Blob([bytes], { type: imageType(tab.path!) }), [bytes, tab.path])
  return url ? <ImageView id={tab.id} active={active} url={url} size={size} /> : null
}

const clampZoom = (z: number) => Math.min(32, Math.max(0.02, z))

/** An image that fits the pane, zoomed with +, -, 0 and 1, the buttons, or ⌘/pinch and scroll. */
export function ImageView({ id, active, url, size, status = true, vector = false }: { id: string; active: boolean; url: string; size?: number; status?: boolean; vector?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState<number | null>(null)
  const [broken, setBroken] = useState(false)
  const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setRoom({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit shrinks photos to the pane but never blows them up; drawings grow to fill it.
  const fit = natural && room.w ? Math.min(vector ? Infinity : 1, (room.w - 32) / natural.w, (room.h - 32) / natural.h) : 1
  const scale = zoom ?? fit

  const zoomTo = (next: number, at?: { x: number; y: number }) => {
    const el = box.current
    if (!el || !natural) return
    const x = at?.x ?? el.clientWidth / 2
    const y = at?.y ?? el.clientHeight / 2
    const img = el.querySelector('img')!.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    anchor.current = { x, y, px: (x + rect.left - img.left) / scale, py: (y + rect.top - img.top) / scale }
    setZoom(clampZoom(next))
  }

  useLayoutEffect(() => {
    const el = box.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = null
    const img = el.querySelector('img')!
    el.scrollLeft += img.getBoundingClientRect().left - el.getBoundingClientRect().left + a.px * scale - a.x
    el.scrollTop += img.getBoundingClientRect().top - el.getBoundingClientRect().top + a.py * scale - a.y
  }, [scale])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomTo(scale * Math.exp(-e.deltaY * 0.01), { x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  useFocus(id, active, box, true)
  const items = natural ? [`${natural.w} × ${natural.h}`, ...(size !== undefined ? [sizeText(size)] : []), `${Math.round(scale * 100)}%`] : []
  useStatus(status ? id : `${id}:image`, status ? items : [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === '+' || e.key === '=') zoomTo(scale * 1.25)
    else if (e.key === '-' || e.key === '_') zoomTo(scale / 1.25)
    else if (e.key === '0') setZoom(null)
    else if (e.key === '1') zoomTo(1)
    else return
    e.preventDefault()
  }

  return (
    <div className="image-view" ref={box} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="image-stage">
        {broken ? (
          <div className="editor-note">This image couldn't be shown.</div>
        ) : (
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              setNatural({ w: img.naturalWidth || 300, h: img.naturalHeight || 150 })
              setBroken(false)
            }}
            onError={() => setBroken(true)}
            style={natural ? { width: natural.w * scale, height: natural.h * scale, imageRendering: scale >= 3 && !vector ? 'pixelated' : undefined } : { visibility: 'hidden' }}
          />
        )}
      </div>
      <div className="image-tools" onMouseDown={(e) => e.preventDefault()}>
        <button title="Zoom out (-)" onClick={() => zoomTo(scale / 1.25)}>−</button>
        <span className="zoom">{Math.round(scale * 100)}%</span>
        <button title="Zoom in (+)" onClick={() => zoomTo(scale * 1.25)}>+</button>
        <button title="Fit (0)" className={zoom === null ? 'on' : ''} onClick={() => setZoom(null)}>Fit</button>
        <button title="Actual size (1)" onClick={() => zoomTo(1)}>1:1</button>
      </div>
    </div>
  )
}

const ROW = 22
const charPx = 8.5

function SheetView({ tab, active, bytes }: Props & { bytes: Uint8Array<ArrayBuffer> }) {
  const parsed = useMemo((): { sheets: Sheet[] } | { error: string } => {
    try {
      return { sheets: readWorkbook(bytes) }
    } catch (err) {
      return { error: errorText(err) }
    }
  }, [bytes])
  if ('error' in parsed) return <NoteView id={tab.id} active={active} text={parsed.error} />
  if (!parsed.sheets.length) return <NoteView id={tab.id} active={active} text="This workbook has no sheets." />
  return <SheetGrid tab={tab} active={active} sheets={parsed.sheets} />
}

function SheetGrid({ tab, active, sheets }: Props & { sheets: Sheet[] }) {
  const [index, setIndex] = useState(0)
  const [cell, setCell] = useState({ r: 0, c: 0 })
  const [view, setView] = useState({ top: 0, height: 600 })
  const box = useRef<HTMLDivElement>(null)
  const sheet = sheets[Math.min(index, sheets.length - 1)]
  const rowCount = Math.max(sheet.rows.length, 1) + 20
  const colCount = Math.max(sheet.cols, 1) + 5
  const widths = useMemo(() => Array.from({ length: colCount }, (_, i) => Math.round((sheet.widths[i] ?? 10) * charPx + 10)), [sheet, colCount])
  const gutter = Math.max(4, String(rowCount).length + 2) * charPx

  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    box.current?.scrollTo(0, 0)
    setView((v) => ({ ...v, top: 0 }))
    setCell({ r: 0, c: 0 })
  }, [index])

  useFocus(tab.id, active, box, true)
  const value = sheet.rows[cell.r]?.[cell.c]
  useStatus(tab.id, [`${columnName(cell.c)}${cell.r + 1}${value ? `: ${value.length > 60 ? value.slice(0, 60) + '…' : value}` : ''}`, `${sheet.rows.length.toLocaleString()} rows`, sheet.name])

  const first = Math.min(Math.max(0, Math.floor(view.top / ROW) - 10), Math.max(0, rowCount - 1))
  const last = Math.min(rowCount, Math.ceil((view.top + view.height) / ROW) + 10)

  const moveTo = (r: number, c: number) => {
    r = Math.max(0, Math.min(rowCount - 1, r))
    c = Math.max(0, Math.min(colCount - 1, c))
    setCell({ r, c })
    const el = box.current
    if (!el) return
    const y = (r + 1) * ROW
    if (y < el.scrollTop + ROW) el.scrollTop = y - ROW
    else if (y + ROW > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW - el.clientHeight
    const x = gutter + widths.slice(0, c).reduce((a, b) => a + b, 0)
    if (x < el.scrollLeft + gutter) el.scrollLeft = x - gutter
    else if (x + widths[c] > el.scrollLeft + el.clientWidth) el.scrollLeft = x + widths[c] - el.clientWidth
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const page = Math.max(1, Math.floor((box.current?.clientHeight ?? 400) / ROW) - 2)
    const k = e.key
    if (k === 'ArrowDown' || k === 'j' || (k === 'Enter' && !e.shiftKey)) moveTo(cell.r + 1, cell.c)
    else if (k === 'ArrowUp' || k === 'k' || (k === 'Enter' && e.shiftKey)) moveTo(cell.r - 1, cell.c)
    else if (k === 'ArrowRight' || k === 'l' || (k === 'Tab' && !e.shiftKey)) moveTo(cell.r, cell.c + 1)
    else if (k === 'ArrowLeft' || k === 'h' || (k === 'Tab' && e.shiftKey)) moveTo(cell.r, cell.c - 1)
    else if (k === 'PageDown') moveTo(cell.r + page, cell.c)
    else if (k === 'PageUp') moveTo(cell.r - page, cell.c)
    else if (k === 'Home') moveTo(cell.r, 0)
    else if (k === 'End') moveTo(cell.r, sheet.cols - 1)
    else if (k === 'g') moveTo(0, cell.c)
    else if (k === 'G') moveTo(sheet.rows.length - 1, cell.c)
    else if (k === ']') setIndex((i) => (i + 1) % sheets.length)
    else if (k === '[') setIndex((i) => (i - 1 + sheets.length) % sheets.length)
    else return
    e.preventDefault()
  }

  const rows = []
  for (let r = first; r < last; r++) {
    const cells = sheet.rows[r]
    rows.push(
      <tr key={r} style={{ height: ROW }}>
        <th className={cell.r === r ? 'on' : ''}>{r + 1}</th>
        {widths.map((_, c) => (
          <td
            key={c}
            className={`${cell.r === r && cell.c === c ? 'selected' : ''} ${sheet.numeric.has(`${r}:${c}`) ? 'num' : ''}`}
            onMouseDown={() => setCell({ r, c })}
          >
            {cells?.[c]}
          </td>
        ))}
      </tr>,
    )
  }

  return (
    <div className="sheet-view">
      <div className="sheet-scroll" ref={box} tabIndex={0} onKeyDown={onKeyDown} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        <table style={{ width: gutter + widths.reduce((a, b) => a + b, 0) }}>
          <colgroup>
            <col style={{ width: gutter }} />
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: ROW }}>
              <th className="corner" />
              {widths.map((_, c) => (
                <th key={c} className={cell.c === c ? 'on' : ''}>
                  {columnName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW }} />}
            {rows}
            {last < rowCount && <tr style={{ height: (rowCount - last) * ROW }} />}
          </tbody>
        </table>
      </div>
      {sheets.length > 1 && (
        <div className="sheet-tabs" onMouseDown={(e) => e.preventDefault()}>
          {sheets.map((s, i) => (
            <button key={s.name + i} className={i === index ? 'on' : ''} onClick={() => setIndex(i)}>
              {s.name}
            </button>
          ))}
          <span className="dim">  [ ] switch sheets</span>
        </div>
      )}
    </div>
  )
}

let frameCode: Promise<string> | null = null

/** The slide renderer and a tiny host page, run in a sandboxed frame so a file can't reach the app. */
function slidesPage(): Promise<string> {
  frameCode ??= import('pptx-preview/dist/pptx-preview.umd.js?raw').then((m) => {
    const lib = (m.default as string).replace(/<\/script/gi, '<\\/script')
    const host = `
const send = (m) => parent.postMessage(m, '*')
addEventListener('message', async (e) => {
  if (e.source !== parent || !e.data || e.data.type !== 'show') return
  const wrap = document.getElementById('slides')
  wrap.innerHTML = ''
  document.documentElement.style.background = e.data.background
  try {
    const p = pptxPreview.init(wrap, { width: e.data.width, height: Math.round(e.data.width * 9 / 16), mode: 'list' })
    await p.preview(e.data.file)
    send({ type: 'done', count: p.slideCount })
  } catch (err) {
    send({ type: 'error', text: String((err && err.message) || err) })
  }
})
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    e.preventDefault()
    send({ type: 'key', key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey })
  }
})
send({ type: 'ready' })`
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0}
#slides .pptx-preview-wrapper{background:transparent!important;height:auto!important;overflow:visible!important;padding:20px 0}
#slides .pptx-preview-wrapper>div{margin-bottom:20px!important;box-shadow:0 2px 12px rgba(0,0,0,.35)}
</style></head><body><div id="slides"></div>
<script>window.require$$0={};window.require$$2={};window.require$$0$1={};window.require$$1={};</script>
<script>${lib}</script>
<script>${host}</script></body></html>`
  })
  return frameCode
}

function SlidesView({ tab, active, bytes }: Props & { bytes: Uint8Array<ArrayBuffer> }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<string | null>(null)
  const [state, setState] = useState<{ count?: number; error?: string }>({})

  useEffect(() => {
    let live = true
    slidesPage().then((p) => live && setPage(p), (err) => live && setState({ error: errorText(err) }))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const m = e.data
      if (m?.type === 'ready') {
        const width = Math.max(320, Math.min(1400, (box.current?.clientWidth ?? 960) - 40))
        const file = bytes.slice().buffer
        const background = getComputedStyle(box.current!).backgroundColor
        frame.current.contentWindow!.postMessage({ type: 'show', file, width, background }, '*', [file])
      } else if (m?.type === 'done') setState({ count: m.count })
      else if (m?.type === 'error') setState({ error: m.text })
      else if (m?.type === 'key') window.dispatchEvent(new KeyboardEvent('keydown', { key: m.key, code: m.code, metaKey: m.metaKey, ctrlKey: m.ctrlKey, altKey: m.altKey, shiftKey: m.shiftKey, bubbles: true, cancelable: true }))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [bytes])

  useFocus(tab.id, active, box, true)
  useStatus(tab.id, state.count !== undefined ? [`${state.count} slides`] : [])

  return (
    <div className="slides-view" ref={box} tabIndex={0}>
      {state.error ? (
        <div className="editor-note">{`Couldn't show these slides: ${state.error}`}</div>
      ) : page ? (
        <iframe ref={frame} title={basename(tab.path!)} sandbox="allow-scripts" srcDoc={page} />
      ) : (
        <div className="editor-note">Opening slides…</div>
      )}
      {!state.error && state.count === undefined && page && <div className="slides-loading">Opening slides…</div>}
    </div>
  )
}
