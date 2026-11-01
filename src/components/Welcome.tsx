import { useEffect, useMemo, useRef, useState } from 'react'
import { newFileHere } from '../lib/actions'
import { keyLabel } from '../lib/commands'
import { register } from '../lib/panes'
import { currentTheme } from '../lib/settings'
import * as S from '../lib/store'

const tickMs = 60

const banners = [
  [
    " __  __",
    "|  \\/  | ___  _ __   ___",
    "| |\\/| |/ _ \\| '_ \\ / _ \\",
    "| |  | | (_) | | | | (_) |",
    "|_|  |_|\\___/|_| |_|\\___/",
  ],
  [
    "    __  ___",
    "   /  |/  /___  ____  ____",
    "  / /|_/ / __ \\/ __ \\/ __ \\",
    " / /  / / /_/ / / / / /_/ /",
    "/_/  /_/\\____/_/ /_/\\____/",
  ],
  [
    " __  __",
    "|  \\/  |___ _ _  ___",
    "| |\\/| / _ \\ ' \\/ _ \\",
    "|_|  |_\\___/_||_\\___/",
  ],
  [
    "███╗   ███╗ ██████╗ ███╗   ██╗ ██████╗",
    "████╗ ████║██╔═══██╗████╗  ██║██╔═══██╗",
    "██╔████╔██║██║   ██║██╔██╗ ██║██║   ██║",
    "██║╚██╔╝██║██║   ██║██║╚██╗██║██║   ██║",
    "██║ ╚═╝ ██║╚██████╔╝██║ ╚████║╚██████╔╝",
    "╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝",
  ],
  [
    "___  ___",
    "|  \\/  |",
    "| .  . | ___  _ __   ___",
    "| |\\/| |/ _ \\| '_ \\ / _ \\",
    "| |  | | (_) | | | | (_) |",
    "\\_|  |_/\\___/|_| |_|\\___/",
  ],
]

type Style = 'plain' | 'solid' | 'gradient' | 'rainbow'
type Art = { lines: string[]; width: number; height: number; style: Style; color: number; offset: number }

const width = (lines: string[]) => Math.max(0, ...lines.map((l) => [...l].length))

function pick(maxWidth: number, maxHeight: number): Art | null {
  const fits = banners.filter((lines) => lines.length <= maxHeight && width(lines) <= maxWidth)
  if (fits.length === 0) return null
  const lines = fits[Math.floor(Math.random() * fits.length)]
  const styles: Style[] = ['plain', 'plain', 'solid', 'gradient', 'rainbow']
  return {
    lines,
    width: width(lines),
    height: lines.length,
    style: styles[Math.floor(Math.random() * styles.length)],
    color: Math.floor(Math.random() * 7),
    offset: Math.floor(Math.random() * 12),
  }
}

function palette(): string[] {
  const p = currentTheme()
  return [p.red, p.orange, p.yellow, p.green, p.cyan, p.blue, p.purple]
}

type Run = { text: string; color: string }

function paint(line: string, row: number, art: Art, tick: number, colors: string[], shine: number | null): Run[] {
  const chars = [...line]
  const dim = 'var(--dim)'
  const color = (col: number): string => {
    if (shine !== null && col >= shine - row && col < shine - row + 8) return 'var(--fg)'
    switch (art.style) {
      case 'solid':
        return colors[art.color % colors.length]
      case 'gradient': {
        const span = Math.min(colors.length, art.height)
        return colors[(art.offset + Math.floor((row * span) / art.height)) % colors.length]
      }
      case 'rainbow':
        return colors[((Math.floor((col + row + art.offset - tick / 2) / 3) % colors.length) + colors.length) % colors.length]
      default:
        return dim
    }
  }
  const runs: Run[] = []
  chars.forEach((ch, col) => {
    const c = color(col)
    const last = runs[runs.length - 1]
    if (last && last.color === c) last.text += ch
    else runs.push({ text: ch, color: c })
  })
  return runs
}

export default function Welcome({ id, active }: { id: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ cols: 0, rows: 0 })
  const [art, setArt] = useState<Art | null>(null)
  const [tick, setTick] = useState(0)
  const fontSize = S.useStore((s) => s.settings.fontSize)
  const themeName = S.useStore((s) => s.previewTheme ?? s.settings.theme)
  const platform = S.useStore((s) => s.platform)

  const items = useMemo(
    () => [
      ['Explorer', keyLabel('E')],
      ['Find files and text', keyLabel('F')],
      ['Terminal', keyLabel('T')],
      ['SQL', keyLabel('D')],
      ['Split terminal', keyLabel('\\')],
      ['New tab', keyLabel('N')],
      ['Switch tabs', `${keyLabel('H')}  ${keyLabel('L')}`],
      ['Switch projects', `${keyLabel('1')}  ${keyLabel('2')}  …`],
      ['Git', keyLabel('G')],
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
    if (area > 0 && (!art || art.height > area || art.width > maxWidth)) {
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
    setArt(area > 0 ? pick(maxWidth, area) : null)
    setTick(0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Tab' || e.key === ' ' || e.key === 'Enter') another()
    else if ('iaoIAO'.includes(e.key) && e.key.length === 1) newFileHere()
    else return
    e.preventDefault()
  }

  const shown = area > 0 ? art : null
  const colors = useMemo(() => palette(), [themeName])
  let lines: Run[][] = []
  if (shown) {
    const reveal = tick * 4
    const revealed = reveal >= shown.width + shown.height
    const sweep = revealed && shown.style === 'plain' ? (((tick - 30) % 80) + 80) % 80 * 2 - 10 : null
    lines = shown.lines.map((line, r) => {
      const visible = revealed ? line : [...line].slice(0, Math.max(0, reveal - r)).join('')
      return paint(visible, r, shown, tick, colors, sweep)
    })
  }

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
