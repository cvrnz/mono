import type { CSSProperties, RefObject } from 'react'
import { updateSettings } from '../lib/settings'
import * as S from '../lib/store'

export type Side = keyof NonNullable<S.Settings['sideWidths']>

export function useSideWidth(side: Side): number | undefined {
  return S.useStore((s) => s.settings.sideWidths?.[side])
}

export function sideStyle(width: number | undefined): CSSProperties | undefined {
  return width ? { width, minWidth: 0, maxWidth: 'none', flex: 'none' } : undefined
}

const setWidth = (side: Side, width: number | undefined) => {
  const widths = { ...S.get().settings.sideWidths, [side]: width }
  if (width === undefined) delete widths[side]
  updateSettings({ sideWidths: widths })
}

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
      if (width) setWidth(side, width)
    }
    document.body.classList.add('resizing-cols')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const reset = () => {
    const el = target.current
    if (el) Object.assign(el.style, { width: '', minWidth: '', maxWidth: '', flex: '' })
    setWidth(side, undefined)
  }
  return <div className="side-splitter" onMouseDown={down} onDoubleClick={reset} title="Drag to resize, double-click for the default width" />
}
