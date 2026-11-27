// WebKit keeps a gutter beside anything that scrolls, even when its scrollbar is idle, unless macOS is set to
// overlay scrollbars. So the page hides native scrollbars (index.css) and this draws a thumb over the content
// while it scrolls, while it's dragged, or while the pointer is at the edge it sits on.
// Monaco and xterm draw their own scrollbars; `markScrolling` and the CSS keep those hidden until they scroll too.

const linger = 900
const edge = 12
const skip = '.monaco-editor, .xterm, .tabbar, .projectbar, .sql-tabs'

type Axis = 'v' | 'h'
type Bar = { el: HTMLElement; thumbs: Record<Axis, HTMLDivElement>; timer: number; held: boolean }

const bars = new Map<HTMLElement, Bar>()
let layer: HTMLDivElement | null = null

function canScroll(el: HTMLElement, axis: Axis) {
  return axis === 'v' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1
}

function scrollable(el: HTMLElement) {
  if (el.closest(skip)) return false
  const s = getComputedStyle(el)
  return (/auto|scroll/.test(s.overflowY) && canScroll(el, 'v')) || (/auto|scroll/.test(s.overflowX) && canScroll(el, 'h'))
}

function place(bar: Bar) {
  const { el, thumbs } = bar
  if (!el.isConnected) return drop(bar)
  const r = el.getBoundingClientRect()
  const top = r.top + el.clientTop
  const left = r.left + el.clientLeft
  for (const axis of ['v', 'h'] as const) {
    const t = thumbs[axis]
    if (!canScroll(el, axis)) {
      t.style.display = 'none'
      continue
    }
    t.style.display = ''
    const view = axis === 'v' ? el.clientHeight : el.clientWidth
    const full = axis === 'v' ? el.scrollHeight : el.scrollWidth
    const at = axis === 'v' ? el.scrollTop : el.scrollLeft
    const size = Math.max(24, (view * view) / full)
    const offset = (at / (full - view)) * (view - size)
    if (axis === 'v') Object.assign(t.style, { top: `${top + offset}px`, left: `${left + el.clientWidth - 9}px`, height: `${size}px` })
    else Object.assign(t.style, { top: `${top + el.clientHeight - 9}px`, left: `${left + offset}px`, width: `${size}px` })
  }
}

function drop(bar: Bar) {
  clearTimeout(bar.timer)
  bar.thumbs.v.remove()
  bar.thumbs.h.remove()
  bars.delete(bar.el)
}

function hideLater(bar: Bar) {
  clearTimeout(bar.timer)
  bar.timer = window.setTimeout(() => {
    if (bar.held || bar.thumbs.v.matches(':hover') || bar.thumbs.h.matches(':hover')) return hideLater(bar)
    bar.thumbs.v.classList.remove('shown')
    bar.thumbs.h.classList.remove('shown')
    bar.timer = window.setTimeout(() => drop(bar), 300)
  }, linger)
}

function thumb(bar: Bar, axis: Axis) {
  const t = document.createElement('div')
  t.className = `overlay-thumb ${axis}`
  t.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    t.setPointerCapture(e.pointerId)
    bar.held = true
    const { el } = bar
    const from = axis === 'v' ? e.clientY : e.clientX
    const start = axis === 'v' ? el.scrollTop : el.scrollLeft
    const view = axis === 'v' ? el.clientHeight : el.clientWidth
    const full = axis === 'v' ? el.scrollHeight : el.scrollWidth
    const size = axis === 'v' ? t.offsetHeight : t.offsetWidth
    const ratio = (full - view) / Math.max(1, view - size)
    const move = (m: PointerEvent) => {
      const to = start + ((axis === 'v' ? m.clientY : m.clientX) - from) * ratio
      if (axis === 'v') el.scrollTop = to
      else el.scrollLeft = to
    }
    const up = () => {
      bar.held = false
      t.removeEventListener('pointermove', move)
      hideLater(bar)
    }
    t.addEventListener('pointermove', move)
    t.addEventListener('pointerup', up, { once: true })
    t.addEventListener('lostpointercapture', up, { once: true })
  })
  layer!.append(t)
  return t
}

function show(el: HTMLElement) {
  let bar = bars.get(el)
  if (!bar) {
    bar = { el, thumbs: {} as Record<Axis, HTMLDivElement>, timer: 0, held: false }
    bar.thumbs = { v: thumb(bar, 'v'), h: thumb(bar, 'h') }
    bars.set(el, bar)
  }
  place(bar)
  bar.thumbs.v.classList.add('shown')
  bar.thumbs.h.classList.add('shown')
  hideLater(bar)
}

function nearEdge(e: PointerEvent) {
  for (let el = e.target instanceof HTMLElement ? e.target : null; el && el !== document.body; el = el.parentElement) {
    if (!scrollable(el)) continue
    const r = el.getBoundingClientRect()
    const right = r.left + el.clientLeft + el.clientWidth
    const bottom = r.top + el.clientTop + el.clientHeight
    if ((canScroll(el, 'v') && right - e.clientX < edge) || (canScroll(el, 'h') && bottom - e.clientY < edge)) show(el)
    return
  }
}

const marked = new WeakMap<Element, number>()

/** Shows a Monaco or xterm scrollbar (`el` is its `.monaco-scrollable-element`) for a moment, as it scrolls. */
export function markScrolling(el: Element | null | undefined) {
  if (!el) return
  el.setAttribute('data-scrolling', '')
  clearTimeout(marked.get(el))
  marked.set(
    el,
    window.setTimeout(() => el.removeAttribute('data-scrolling'), linger),
  )
}

export function installScrollbars() {
  layer = document.createElement('div')
  layer.className = 'overlay-thumbs'
  document.body.append(layer)
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target
      if (el instanceof HTMLElement && el !== document.body && !el.closest(skip)) show(el)
      for (const bar of bars.values()) if (bar.el !== el) place(bar)
    },
    { capture: true, passive: true },
  )
  document.addEventListener(
    'wheel',
    (e) => markScrolling((e.target as Element | null)?.closest?.('.monaco-scrollable-element, .xterm-scrollable-element')),
    { capture: true, passive: true },
  )
  let pending: PointerEvent | null = null
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.buttons) return
      if (!pending)
        requestAnimationFrame(() => {
          nearEdge(pending!)
          pending = null
        })
      pending = e
    },
    { passive: true },
  )
  window.addEventListener('resize', () => bars.forEach(place))
}
