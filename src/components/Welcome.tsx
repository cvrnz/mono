import { useEffect, useMemo, useRef, useState } from 'react'
import { newFileHere } from '../lib/actions'
import { keyLabel } from '../lib/commands'
import { register } from '../lib/panes'
import { currentTheme } from '../lib/settings'
import * as S from '../lib/store'
import { type Cell, type Picked, pick } from '../lib/ascii'

const tickMs = 60

function palette(): string[] {
  const p = currentTheme()
  return [p.red, p.orange, p.yellow, p.green, p.cyan, p.blue, p.purple]
}

type Run = { text: string; color: string }

function runs(row: Cell[]): Run[] {
  const out: Run[] = []
  for (const { ch, color } of row) {
    const last = out[out.length - 1]
    if (last && (last.color === color || ch === ' ')) last.text += ch
    else out.push({ text: ch, color })
  }
  return out
}

export default function Welcome({ id, active }: { id: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ cols: 0, rows: 0 })
  const [art, setArt] = useState<Picked | null>(null)
  const [tick, setTick] = useState(0)
  const fontSize = S.useStore((s) => s.settings.fontSize)
  const themeName = S.useStore((s) => s.previewTheme ?? s.settings.theme)
  const platform = S.useStore((s) => s.platform)

  const items = useMemo(
    () => [
      ['Explorer', keyLabel('E')],
      ['Find in this file', keyLabel('F')],
      ['Search files and text', keyLabel('Shift+F')],
      ['Terminal', keyLabel('T')],
      ['SQL', keyLabel('D')],
      ['Split terminal', keyLabel('\\')],
      ['New tab', keyLabel('N')],
      ['Switch tabs', `${keyLabel('H')}  ${keyLabel('L')}`],
      ['Switch projects', `${keyLabel('1')}  ${keyLabel('2')}  …`],
      ['Git', keyLabel('G')],
      ['Run', keyLabel('Shift+R')],
      ['Close', keyLabel('W')],
      ['Command palette', keyLabel('P')],
    ],
    [platform],
  )

  const below = 6 + items.length * 2 - 1 + 5
  const area = (() => {
    const a = Math.min(18, size.rows - below - 2)
    return a >= 4 ? a : 0
  })()
  const maxWidth = size.cols - 4

  useEffect(() => {
    const el = box.current!
    const measure = () => {
      const lh = fontSize * 1.2
      const cw = fontSize * 0.6
      setSize({ cols: Math.floor(el.clientWidth / cw), rows: Math.floor(el.clientHeight / lh) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fontSize])

  useEffect(() => {
    if (area > 0 && (!art || art.piece.height > area || art.piece.width > maxWidth)) {
      setArt(pick(maxWidth, area))
      setTick(0)
    }
  }, [area, maxWidth, art])

  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setTick((n) => n + 1), tickMs)
    return () => clearInterval(t)
  }, [active])

  useEffect(() => register(id, { focus: () => box.current?.focus() }), [id])
  useEffect(() => {
    if (active) requestAnimationFrame(() => box.current?.focus())
  }, [active])
  useEffect(() => {
    S.setPaneStatus(id, { mode: 'normal', items: [] })
    return () =>
      S.set((s) => {
        const status = { ...s.status }
        delete status[id]
        return { status }
      })
  }, [id])

  const another = () => {
    setArt(area > 0 ? pick(maxWidth, area, art?.kind) : null)
    setTick(0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Tab' || e.key === ' ' || e.key === 'Enter') another()
    else if ('iaoIAO'.includes(e.key) && e.key.length === 1) newFileHere()
    else return
    e.preventDefault()
  }

  const colors = useMemo(() => palette(), [themeName])
  const lines = area > 0 && art ? art.piece.frame(tick, colors).map(runs) : []

  const lh = '1.2em'
  return (
    <div
      ref={box}
      className="welcome"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        e.preventDefault()
        box.current?.focus()
        another()
      }}
      style={{ fontSize, lineHeight: lh }}
    >
      {area > 0 && (
        <div className="art" style={{ height: `calc(${area} * ${lh})` }}>
          <pre>
            {lines.map((runs, i) => (
              <div key={i} style={{ height: lh }}>
                {runs.map((r, j) => (
                  <span key={j} style={{ color: r.color }}>
                    {r.text}
                  </span>
                ))}
              </div>
            ))}
          </pre>
        </div>
      )}
      <div className="shortcuts">
        {items.map(([label, key]) => (
          <div key={label} style={{ display: 'contents' }}>
            <span>{label}</span>
            <span className="k">{key}</span>
          </div>
        ))}
      </div>
      <div className="hint">
        <b>Tab</b>  another one
      </div>
      <div className="dim" style={{ marginTop: '1.2em' }}>
        Mono 0.1.0
      </div>
    </div>
  )
}
