import { useEffect, useMemo, useRef, useState } from 'react'
import { copyText } from '../lib/bridge'
import { toast } from '../lib/dialogs'
import { charWidth } from '../lib/metrics'
import type { Cell, ResultSet } from '../lib/sql'
import * as S from '../lib/store'

const ROW = 24
const MAX_CHARS = 48

function text(c: Cell): string {
  if (c === null) return 'NULL'
  return String(c)
}

function oneLine(c: Cell): string {
  return text(c).replace(/\r?\n/g, '⏎').replace(/\t/g, '→')
}

export default function SqlGrid({ set, autoFocus }: { set: ResultSet; autoFocus?: boolean }) {
  const { fontFamily, fontSize } = S.useStore((s) => s.settings)
  const size = Math.max(11, fontSize - 1)
  const host = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 600 })
  const [sel, setSel] = useState({ r: 0, c: 0 })

  const cw = charWidth(fontFamily, size)
  const numWidth = Math.ceil(String(set.rows.length).length * cw) + 20
  const widths = useMemo(() => {
    return set.columns.map((name, i) => {
      let n = name.length
      for (let r = 0; r < Math.min(set.rows.length, 300); r++) n = Math.max(n, oneLine(set.rows[r][i]).length)
      return Math.ceil(Math.min(MAX_CHARS, Math.max(4, n)) * cw) + 24
    })
  }, [set, cw])
  const lefts = useMemo(() => {
    const out: number[] = []
    let x = numWidth
    for (const w of widths) {
      out.push(x)
      x += w
    }
    return out
  }, [widths, numWidth])
  const total = numWidth + widths.reduce((a, b) => a + b, 0)

  useEffect(() => setSel({ r: 0, c: 0 }), [set])
  useEffect(() => {
    if (autoFocus) host.current?.focus()
  }, [autoFocus, set])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => setScroll({ top: el.scrollTop, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el || set.rows.length === 0) return
    const top = (sel.r + 1) * ROW
    if (top < el.scrollTop + ROW) el.scrollTop = top - ROW
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
    const left = lefts[sel.c] ?? 0
    const right = left + (widths[sel.c] ?? 0)
    if (left < el.scrollLeft + numWidth) el.scrollLeft = left - numWidth
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }, [sel, lefts, widths, numWidth, set])

  const copy = async (value: string, what: string) => {
    await copyText(value)
    toast(`Copied ${what}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const rows = set.rows.length
    const cols = set.columns.length
    if (rows === 0) return
    const page = Math.max(1, Math.floor(scroll.height / ROW) - 2)
    const go = (r: number, c: number) => setSel({ r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) })
    const k = e.key
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (k === 'c' || k === 'C')) {
      copy(text(set.rows[sel.r][sel.c]), 'the cell')
    } else if (e.ctrlKey || e.metaKey || e.altKey) return
    else if (k === 'j' || k === 'ArrowDown') go(sel.r + 1, sel.c)
    else if (k === 'k' || k === 'ArrowUp') go(sel.r - 1, sel.c)
    else if (k === 'l' || k === 'ArrowRight' || (k === 'Tab' && !e.shiftKey)) go(sel.r, sel.c + 1)
    else if (k === 'h' || k === 'ArrowLeft' || (k === 'Tab' && e.shiftKey)) go(sel.r, sel.c - 1)
    else if (k === 'PageDown') go(sel.r + page, sel.c)
    else if (k === 'PageUp') go(sel.r - page, sel.c)
    else if (k === 'g' || k === 'Home') go(0, sel.c)
    else if (k === 'G' || k === 'End') go(rows - 1, sel.c)
    else if (k === '0' || k === '^') go(sel.r, 0)
    else if (k === '$') go(sel.r, cols - 1)
    else if (k === 'y') copy(text(set.rows[sel.r][sel.c]), 'the cell')
    else if (k === 'Y') copy(set.rows[sel.r].map(text).join('\t'), 'the row')
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const first = Math.max(0, Math.floor(scroll.top / ROW) - 1 - 10)
  const last = Math.min(set.rows.length, Math.ceil((scroll.top + scroll.height) / ROW) + 10)
  const numeric = useMemo(
    () => set.columns.map((_, i) => set.rows.length > 0 && set.rows.slice(0, 50).every((r) => r[i] === null || typeof r[i] === 'number')),
    [set],
  )

  const style = { fontFamily, fontSize: size, lineHeight: `${ROW}px` }
  return (
    <div
      ref={host}
      className="sql-grid"
      tabIndex={0}
      style={style}
      onKeyDown={onKeyDown}
      onScroll={(e) => {
        const el = e.currentTarget
        setScroll({ top: el.scrollTop, height: el.clientHeight })
      }}
    >
      <div style={{ position: 'relative', width: total, height: (set.rows.length + 1) * ROW }}>
        <div className="sql-head" style={{ width: total, height: ROW }}>
          <div className="sql-num sql-corner" style={{ width: numWidth }} />
          {set.columns.map((name, i) => (
            <div key={i} className="sql-cell" style={{ left: lefts[i], width: widths[i], textAlign: numeric[i] ? 'right' : undefined }} title={name}>
              {name}
            </div>
          ))}
        </div>
        {set.rows.slice(first, last).map((row, j) => {
          const r = first + j
          return (
            <div key={r} className={`sql-row ${r === sel.r ? 'on' : ''}`} style={{ top: (r + 1) * ROW, width: total, height: ROW }}>
              <div className="sql-num" style={{ width: numWidth }}>
                {r + 1}
              </div>
              {row.map((c, i) => (
                <div
                  key={i}
                  className={`sql-cell ${c === null ? 'null' : ''} ${r === sel.r && i === sel.c ? 'selected' : ''}`}
                  style={{ left: lefts[i], width: widths[i], textAlign: numeric[i] ? 'right' : undefined }}
                  onMouseDown={() => setSel({ r, c: i })}
                  onDoubleClick={() => copy(text(c), 'the cell')}
                  title={c !== null && text(c).length > MAX_CHARS ? text(c).slice(0, 2000) : undefined}
                >
                  {oneLine(c)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
