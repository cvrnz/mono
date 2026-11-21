import type { RefObject } from 'react'
import { setSideWidth, type Side } from '../lib/sides'

export default function SideSplitter({ side, target }: { side: Side; target: RefObject<HTMLElement | null> }) {
  const down = (e: React.MouseEvent) => {
    const el = target.current
    if (e.button !== 0 || !el?.parentElement) return
    e.preventDefault()
    const left = el.getBoundingClientRect().left
    const room = el.parentElement.getBoundingClientRect().width
    let width = 0
    const onMove = (ev: MouseEvent) => {
      width = Math.round(Math.min(room - 160, Math.max(120, ev.clientX - left)))
      Object.assign(el.style, { width: `${width}px`, minWidth: '0', maxWidth: 'none', flex: 'none' })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-cols')
      if (width) setSideWidth(side, width)
    }
    document.body.classList.add('resizing-cols')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const reset = () => {
    const el = target.current
    if (el) Object.assign(el.style, { width: '', minWidth: '', maxWidth: '', flex: '' })
    setSideWidth(side, undefined)
  }
  return <div className="side-splitter" onMouseDown={down} onDoubleClick={reset} title="Drag to resize, double-click for the default width" />
}
