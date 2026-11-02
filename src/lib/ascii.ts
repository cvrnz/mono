export type Cell = { ch: string; color: string }
export type Piece = { width: number; height: number; frame: (tick: number, colors: string[]) => Cell[][] }
export type Make = (maxWidth: number, maxHeight: number) => Piece | null

const fg = 'var(--fg)'
const space: Cell = { ch: ' ', color: fg }
const ramp = ' .:-=+*#%@'

const rand = (n: number) => Math.floor(Math.random() * n)
const one = <T>(xs: T[]): T => xs[rand(xs.length)]
const at = <T>(xs: T[], i: number): T => xs[((Math.floor(i) % xs.length) + xs.length) % xs.length]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const art = (text: string) => text.replace(/^\n/, '').replace(/\n$/, '').split('\n')
const widthOf = (lines: string[]) => Math.max(0, ...lines.map((l) => [...l].length))
const grid = (w: number, h: number): Cell[][] => Array.from({ length: h }, () => Array<Cell>(w).fill(space))

function put(g: Cell[][], x: number, y: number, ch: string, color: string) {
  if (y >= 0 && y < g.length && x >= 0 && x < g[y].length && ch !== ' ') g[y][x] = { ch, color }
}

function text(g: Cell[][], x: number, y: number, lines: string[], color: (ch: string) => string) {
  lines.forEach((line, r) => [...line].forEach((ch, c) => put(g, x + c, y + r, ch, color(ch))))
}

// Advances the simulation once per tick, however many times React renders that tick.
function stateful(width: number, height: number, step: (tick: number) => void, draw: (tick: number, colors: string[]) => Cell[][]): Piece {
  let last = -1
  return {
    width,
    height,
    frame(tick, colors) {
      if (tick !== last) {
        last = tick
        step(tick)
      }
      return draw(tick, colors)
    },
  }
}

const banners = [
  [
    ' __  __',
    '|  \\/  | ___  _ __   ___',
    '| |\\/| |/ _ \\| \'_ \\ / _ \\',
    '| |  | | (_) | | | | (_) |',
    '|_|  |_|\\___/|_| |_|\\___/',
  ],
  [
    '    __  ___',
    '   /  |/  /___  ____  ____',
    '  / /|_/ / __ \\/ __ \\/ __ \\',
    ' / /  / / /_/ / / / / /_/ /',
    '/_/  /_/\\____/_/ /_/\\____/',
  ],
  [
    ' __  __',
    '|  \\/  |___ _ _  ___',
    '| |\\/| / _ \\ \' \\/ _ \\',
    '|_|  |_\\___/_||_\\___/',
  ],
  [
    '███╗   ███╗ ██████╗ ███╗   ██╗ ██████╗',
    '████╗ ████║██╔═══██╗████╗  ██║██╔═══██╗',
    '██╔████╔██║██║   ██║██╔██╗ ██║██║   ██║',
    '██║╚██╔╝██║██║   ██║██║╚██╗██║██║   ██║',
    '██║ ╚═╝ ██║╚██████╔╝██║ ╚████║╚██████╔╝',
    '╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝',
  ],
  [
    '___  ___',
    '|  \\/  |',
    '| .  . | ___  _ __   ___',
    '| |\\/| |/ _ \\| \'_ \\ / _ \\',
    '| |  | | (_) | | | | (_) |',
    '\\_|  |_/\\___/|_| |_|\\___/',
  ],
  art(`
┳┳┓┏┓┳┓┏┓
┃┃┃┃┃┃┃┃┃
┛ ┗┗┛┛┗┗┛
`),
  art(`
█▀▄▀█ █▀▀█ █▀▀▄ █▀▀█
█ ▀ █ █  █ █  █ █  █
▀   ▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀
`),
  art(`
█▀▄▀█ █▀█ █▄ █ █▀█
█ ▀ █ █▄█ █ ▀█ █▄█
`),
  art(String.raw`
 __    __     ______     __   __     ______
/\ "-./  \   /\  __ \   /\ "-.\ \   /\  __ \
\ \ \-./\ \  \ \ \/\ \  \ \ \-.  \  \ \ \/\ \
 \ \_\ \ \_\  \ \_____\  \ \_\\"\_\  \ \_____\
  \/_/  \/_/   \/_____/   \/_/ \/_/   \/_____/
`),
]

type Style = 'solid' | 'gradient' | 'rainbow' | 'wave' | 'pulse' | 'sparkle' | 'fire'
const styles: Style[] = ['solid', 'gradient', 'rainbow', 'wave', 'pulse', 'sparkle', 'fire']

function banner(maxWidth: number, maxHeight: number): Piece | null {
  const fits = banners.filter((l) => l.length <= maxHeight && widthOf(l) <= maxWidth)
  if (fits.length === 0) return null
  const lines = one(fits)
  const rows = lines.map((l) => [...l])
  const w = widthOf(lines)
  const h = lines.length
  const style = one(styles)
  const base = rand(7)
  const offset = rand(12)

  const color = (col: number, row: number, tick: number, colors: string[]): string => {
    switch (style) {
      case 'solid':
        return at(colors, base)
      case 'gradient':
        return at(colors, offset + Math.floor((row * Math.min(colors.length, h)) / h))
      case 'rainbow':
        return at(colors, (col + row + offset - tick / 2) / 3)
      case 'wave':
        return at(colors, base + Math.round(Math.sin(col / 5 - tick / 5 + row / 3) * 1.5))
      case 'pulse':
        return at(colors, base + (tick - col / 2) / 12)
      case 'sparkle':
        return hash(col, row, Math.floor(tick / 3)) < 0.05 ? fg : at(colors, base)
      case 'fire': {
        const v = (h - 1 - row) / Math.max(1, h - 1) + (hash(col, row, Math.floor(tick / 2)) - 0.5) * 0.7
        return colors[v < 0.33 ? 0 : v < 0.66 ? 1 : 2]
      }
    }
  }

  return {
    width: w,
    height: h,
    frame(tick, colors) {
      const reveal = tick * 4
      const revealed = reveal >= w + h
      const shine = revealed && (style === 'solid' || style === 'gradient') ? ((((tick - 30) % 80) + 80) % 80) * 2 - 10 : null
      return rows.map((chars, row) =>
        chars.map((ch, col) => {
          if (!revealed && col >= reveal - row) return space
          if (shine !== null && col >= shine - row && col < shine - row + 8) return { ch, color: fg }
          return { ch, color: color(col, row, tick, colors) }
        }),
      )
    },
  }
}

function picture(lines: string[], paint: (ch: string, col: number, row: number, tick: number, colors: string[]) => Cell): Make {
  const rows = lines.map((l) => [...l])
  const w = widthOf(lines)
  const h = lines.length
  return (mw, mh) =>
    w > mw || h > mh
      ? null
      : { width: w, height: h, frame: (tick, colors) => rows.map((chars, row) => chars.map((ch, col) => paint(ch, col, row, tick, colors))) }
}

const cat = picture(
  art(String.raw`
   /\_/\
  ( o.o )
   > ^ <
  /  |  \
 (___|___)~
`),
  (ch, _col, _row, tick, colors) => {
    if (ch === 'o') return { ch: tick % 70 < 4 ? '-' : 'o', color: colors[3] }
    if (ch === '^') return { ch, color: colors[0] }
    if (ch === '~') return { ch: Math.floor(tick / 6) % 2 ? '~' : '-', color: colors[1] }
    if (ch === '>' || ch === '<') return { ch, color: colors[2] }
    return { ch, color: colors[1] }
  },
)

const steam = ['  (  )   (', '   )  (   )', '  (    )  (', '   )  (    )']
const mug = picture(
  [' '.repeat(13), ' '.repeat(13), ' '.repeat(13), ...art(String.raw`
  .-------.
  |       |-.
  |  mono | |
  |       |-'
  '-------'
`)],
  (ch, col, row, tick, colors) => {
    if (row < 3) {
      const c = [...at(steam, row + tick / 6)][col] ?? ' '
      return { ch: c, color: at(colors, 4 + row + tick / 20) }
    }
    if ('mon'.includes(ch)) return { ch, color: colors[4] }
    return { ch, color: colors[1] }
  },
)

function sized(maxWidth: number, maxHeight: number): [number, number] | null {
  const w = Math.min(maxWidth, 72)
  const h = Math.min(maxHeight, 14)
  return w >= 24 && h >= 6 ? [w, h] : null
}

const stars: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  const field = Array.from({ length: Math.floor((w * h) / 10) }, () => ({ x: rand(w), y: rand(h), phase: Math.random() * 7, color: rand(7) }))
  let shot: { x: number; y: number } | null = null
  return stateful(
    w,
    h,
    () => {
      if (shot) {
        shot.x += 2
        shot.y += 0.5
        if (shot.x > w + 6 || shot.y > h) shot = null
      } else if (Math.random() < 0.02) shot = { x: rand(w / 2), y: rand(h / 3) }
    },
    (tick, colors) => {
      const g = grid(w, h)
      for (const st of field) {
        const b = (Math.sin(tick / 8 + st.phase) + 1) / 2
        put(g, st.x, st.y, '.·+*'[Math.min(3, Math.floor(b * 4))], at(colors, st.color))
      }
      if (shot) {
        for (let i = 0; i < 6; i++) put(g, Math.round(shot.x) - i * 2, Math.round(shot.y - i * 0.5), i === 0 ? '*' : '-', i === 0 ? fg : colors[2])
      }
      return g
    },
  )
}

const matrix: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  const glyphs = 'abcdef0123456789$+-*/=%#&<>[]{}?!'
  const chars = Array.from({ length: h }, () => Array.from({ length: w }, () => one([...glyphs])))
  const drops = Array.from({ length: w }, () => ({ y: -rand(h * 2), speed: 0.3 + Math.random() * 0.7, len: 4 + rand(h) }))
  return stateful(
    w,
    h,
    () => {
      for (const d of drops) {
        d.y += d.speed
        if (d.y - d.len > h) Object.assign(d, { y: -rand(h), speed: 0.3 + Math.random() * 0.7, len: 4 + rand(h) })
      }
      for (let i = 0; i < w; i++) chars[rand(h)][rand(w)] = one([...glyphs])
    },
    (_tick, colors) => {
      const g = grid(w, h)
      drops.forEach((d, x) => {
        if (x % 2) return
        const head = Math.floor(d.y)
        for (let y = head - d.len; y <= head; y++) {
          const k = (head - y) / d.len
          put(g, x, y, chars[clamp(y, 0, h - 1)][x], y === head ? fg : k < 0.4 ? colors[3] : k < 0.75 ? colors[4] : colors[5])
        }
      })
      return g
    },
  )
}

const fire: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  const max = Math.round(h * 0.6)
  const heat = new Array<number>(w * (h + 1)).fill(0)
  return stateful(
    w,
    h,
    () => {
      for (let x = 0; x < w; x++) heat[h * w + x] = max - rand(2)
      for (let y = 1; y <= h; y++) {
        for (let x = 0; x < w; x++) {
          const r = rand(3)
          heat[(y - 1) * w + clamp(x - r + 1, 0, w - 1)] = Math.max(0, heat[y * w + x] - (r > 0 ? 1 : 0))
        }
      }
    },
    (_tick, colors) => {
      const g = grid(w, h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = heat[y * w + x] / max
          if (v <= 0) continue
          const color = v < 0.3 ? colors[0] : v < 0.55 ? colors[1] : v < 0.8 ? colors[2] : fg
          put(g, x, y, ramp[clamp(Math.round(v * (ramp.length - 1)), 1, ramp.length - 1)], color)
        }
      }
      return g
    },
  )
}

const plasma: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  return {
    width: w,
    height: h,
    frame(tick, colors) {
      const t = tick / 10
      return Array.from({ length: h }, (_, y) =>
        Array.from({ length: w }, (_, x) => {
          const v =
            Math.sin(x / 4 + t) +
            Math.sin(y / 2 + t * 0.7) +
            Math.sin((x + y) / 6 + t * 1.3) +
            Math.sin(Math.hypot(x - w / 2, (y - h / 2) * 2) / 4 - t)
          const n = (v + 4) / 8
          return { ch: ramp[clamp(Math.round(n * (ramp.length - 1)), 1, ramp.length - 1)], color: at(colors, n * 7 + tick / 8) }
        }),
      )
    },
  }
}

const boat = art(String.raw`
  |\
  | \
 _|__\_
 \____/
`)

const ocean: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  return {
    width: w,
    height: h,
    frame(tick, colors) {
      const t = tick / 8
      const g = grid(w, h)
      const surface = (x: number) => h * 0.55 + Math.sin(x / 6 + t) * 1.2 + Math.sin(x / 13 - t * 0.7) * 0.8
      const sx = w - 10
      for (let y = 0; y < 4; y++) {
        for (let x = sx - 6; x <= sx + 6; x++) {
          if (((x - sx) / 2) ** 2 + (y - 1.5) ** 2 < 4) put(g, x, y, y < 2 ? '@' : '#', y < 2 ? colors[2] : colors[1])
        }
      }
      for (let x = 0; x < w; x++) {
        const top = surface(x)
        for (let y = Math.ceil(top); y < h; y++) {
          const d = y - top
          const ch = d < 1 ? '~' : '~- ~ -'[Math.floor(hash(x, y, Math.floor((tick + x * 2) / 6)) * 6)]
          put(g, x, y, ch, d < 1 ? fg : at(colors, 4 + Math.floor(d / 2)))
        }
      }
      const bx = (Math.floor(tick / 3) % (w + 10)) - 8
      const by = Math.round(surface(bx + 3)) - boat.length + 1
      text(g, bx, by, boat, (ch) => ('|\\'.includes(ch) ? fg : colors[1]))
      return g
    },
  }
}

const logo = banners[5]

const bounce: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  const lw = widthOf(logo)
  let x = rand(w - lw - 2)
  let y = rand(h - logo.length - 2)
  let dx = 0.5
  let dy = 0.25
  let color = rand(7)
  return stateful(
    w,
    h,
    () => {
      x += dx
      y += dy
      if (x <= 0 || x >= w - 2 - lw) {
        dx = -dx
        x = clamp(x, 0, w - 2 - lw)
        color++
      }
      if (y <= 0 || y >= h - 2 - logo.length) {
        dy = -dy
        y = clamp(y, 0, h - 2 - logo.length)
        color++
      }
    },
    (_tick, colors) => {
      const g = grid(w, h)
      const edge = at(colors, color + 3)
      for (let i = 1; i < w - 1; i++) {
        put(g, i, 0, '─', edge)
        put(g, i, h - 1, '─', edge)
      }
      for (let j = 1; j < h - 1; j++) {
        put(g, 0, j, '│', edge)
        put(g, w - 1, j, '│', edge)
      }
      put(g, 0, 0, '┌', edge)
      put(g, w - 1, 0, '┐', edge)
      put(g, 0, h - 1, '└', edge)
      put(g, w - 1, h - 1, '┘', edge)
      text(g, 1 + Math.round(x), 1 + Math.round(y), logo, () => at(colors, color))
      return g
    },
  )
}

const life: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  let age: number[] = []
  let gone: boolean[] = []
  let gen = 0
  const seed = () => {
    age = Array.from({ length: w * h }, () => (Math.random() < 0.3 ? 1 : 0))
    gone = new Array<boolean>(w * h).fill(false)
    gen = 0
  }
  seed()
  return stateful(
    w,
    h,
    (tick) => {
      if (tick % 3) return
      const next = age.map((a, i) => {
        const x = i % w
        const y = Math.floor(i / w)
        let n = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && age[((y + dy + h) % h) * w + ((x + dx + w) % w)]) n++
        return a ? (n === 2 || n === 3 ? a + 1 : 0) : n === 3 ? 1 : 0
      })
      const alive = next.filter(Boolean).length
      const same = next.every((a, i) => !a === !age[i])
      gone = age.map((a, i) => a > 0 && !next[i])
      age = next
      if (++gen > 400 || same || alive < w * h * 0.04) seed()
    },
    (_tick, colors) => {
      const g = grid(w, h)
      age.forEach((a, i) => {
        const x = i % w
        const y = Math.floor(i / w)
        if (a) put(g, x, y, a < 3 ? 'o' : a < 8 ? 'O' : '@', colors[3 + Math.min(3, Math.floor(a / 4))])
        else if (gone[i]) put(g, x, y, '.', colors[0])
      })
      return g
    },
  )
}

const equalizer: Make = (mw, mh) => {
  const s = sized(mw, mh)
  if (!s) return null
  const [w, h] = s
  const n = Math.floor(w / 3)
  const level = new Array<number>(n).fill(0)
  const peak = new Array<number>(n).fill(0)
  const target = new Array<number>(n).fill(0)
  return stateful(
    n * 3 - 1,
    h,
    (tick) => {
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.15) target[i] = Math.random() * h * (0.5 + 0.5 * Math.abs(Math.sin(i / 3 + tick / 40)))
        level[i] += (target[i] - level[i]) * 0.3
        peak[i] = Math.max(peak[i] - 0.15, level[i])
      }
    },
    (_tick, colors) => {
      const g = grid(n * 3 - 1, h)
      for (let i = 0; i < n; i++) {
        for (let y = 0; y < h; y++) {
          const k = h - 1 - y
          const color = k < h * 0.5 ? colors[3] : k < h * 0.75 ? colors[2] : colors[0]
          if (k < level[i]) {
            put(g, i * 3, y, '█', color)
            put(g, i * 3 + 1, y, '█', color)
          } else if (k === Math.floor(peak[i])) {
            put(g, i * 3, y, '▀', fg)
            put(g, i * 3 + 1, y, '▀', fg)
          }
        }
      }
      return g
    },
  )
}

const makers: Make[] = [banner, banner, banner, cat, mug, stars, matrix, fire, plasma, ocean, bounce, life, equalizer]

// Picks a piece that fits, avoiding the kind shown last when there's another choice.
export type Picked = { piece: Piece; kind: Make }

export function pick(maxWidth: number, maxHeight: number, last?: Make): Picked | null {
  const options = makers
    .map((kind) => ({ kind, piece: kind(maxWidth, maxHeight) }))
    .filter((o): o is Picked => o.piece !== null)
  const fresh = options.filter((o) => o.kind !== last)
  const from = fresh.length > 0 ? fresh : options
  return from.length > 0 ? one(from) : null
}
