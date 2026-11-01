import type { IDecoration, IMarker, Terminal } from '@xterm/xterm'
import { copyText } from './bridge'

export type TermMode = 'terminal' | 'normal' | 'visual' | 'visual-line'

type Pos = { row: number; col: number }

type Hooks = {
  send(data: string): void
  changed(mode: TermMode): void
  prompt(back: boolean): void
}

const escTimeout = 300

const wordClass = (ch: string) => (/\s/.test(ch) || ch === '' ? 0 : /\w/.test(ch) ? 1 : 2)

export class TermVim {
  mode: TermMode = 'terminal'
  private cur: Pos = { row: 0, col: 0 }
  private want = 0
  private anchor: Pos = { row: 0, col: 0 }
  private count = ''
  private pending = ''
  private escTimer: ReturnType<typeof setTimeout> | null = null
  private marker: IMarker | undefined
  private deco: IDecoration | undefined
  private lastSearch: { text: string; back: boolean } | null = null

  private term: Terminal
  private hooks: Hooks

  constructor(term: Terminal, hooks: Hooks) {
    this.term = term
    this.hooks = hooks
  }

  key(e: KeyboardEvent): boolean {
    if (this.mode === 'terminal') return this.terminalKey(e)
    if (e.type === 'keydown') {
      e.preventDefault()
      this.normalKey(e)
    }
    return false
  }

  dispose() {
    if (this.escTimer) clearTimeout(this.escTimer)
    this.clearCursor()
  }

  private terminalKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown') return true
    const plainEsc = e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
    if (this.escTimer) {
      clearTimeout(this.escTimer)
      this.escTimer = null
      if (plainEsc) {
        this.enter()
        return false
      }
      this.hooks.send('\x1b')
      return true
    }
    if (plainEsc) {
      this.escTimer = setTimeout(() => {
        this.escTimer = null
        this.hooks.send('\x1b')
      }, escTimeout)
      return false
    }
    return true
  }

  private get buf() {
    return this.term.buffer.active
  }

  private text(row: number): string {
    return this.buf.getLine(row)?.translateToString(true) ?? ''
  }

  private lastRow(): number {
    const b = this.buf
    let last = b.baseY + b.cursorY
    for (let r = b.length - 1; r > last; r--) {
      if (this.text(r) !== '') {
        last = r
        break
      }
    }
    return last
  }

  private enter() {
    const b = this.buf
    this.cur = { row: b.baseY + b.cursorY, col: b.cursorX }
    this.want = this.cur.col
    this.count = ''
    this.pending = ''
    this.setMode('normal')
    this.show()
  }

  private leave() {
    this.term.clearSelection()
    this.clearCursor()
    this.setMode('terminal')
    this.term.scrollToBottom()
  }

  private setMode(m: TermMode) {
    this.mode = m
    this.hooks.changed(m)
  }

  private normalKey(e: KeyboardEvent) {
    const k = e.key
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(k)) return
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey
    const rows = this.term.rows

    if (!ctrl && /^[0-9]$/.test(k) && (this.count || k !== '0')) {
      this.count += k
      return
    }
    const n = Math.max(1, Number(this.count) || 1)
    const hadCount = this.count !== ''
    this.count = ''
    const pending = this.pending
    this.pending = ''

    if (ctrl) {
      const l = k.toLowerCase()
      if (l === 'e' || l === 'y') {
        this.term.scrollLines(l === 'e' ? n : -n)
        this.keepInView()
        return
      }
      const half = Math.floor(rows / 2)
      const step = ({ u: -half, d: half, b: -rows, f: rows } as Record<string, number>)[l]
      if (step !== undefined) {
        this.term.scrollLines(step * n)
        this.moveRow(this.cur.row + step * n)
      }
      return
    }

    if (pending === 'g') {
      if (k === 'g') this.moveRow(hadCount ? n - 1 : 0)
      return
    }
    if (pending === 'y') {
      if (k === 'y') {
        const lines: string[] = []
        for (let r = this.cur.row; r < this.cur.row + n && r <= this.lastRow(); r++) lines.push(this.text(r))
        copyText(lines.join('\n'))
      }
      return
    }

    switch (k) {
      case 'Escape':
        if (this.mode !== 'normal') {
          this.term.clearSelection()
          this.setMode('normal')
        }
        return
      case 'i':
      case 'a':
      case 'I':
      case 'A':
      case 'Enter':
        this.leave()
        return
      case 'h':
      case 'ArrowLeft':
      case 'Backspace':
        this.moveCol(this.cur.col - n)
        return
      case 'l':
      case 'ArrowRight':
      case ' ':
        this.moveCol(Math.min(this.cur.col + n, Math.max(0, this.text(this.cur.row).length - 1)))
        return
      case 'j':
      case 'ArrowDown':
        this.moveRow(this.cur.row + n)
        return
      case 'k':
      case 'ArrowUp':
        this.moveRow(this.cur.row - n)
        return
      case '0':
      case 'Home':
        this.moveCol(0)
        return
      case '^':
        this.moveCol(Math.max(0, this.text(this.cur.row).search(/\S/)))
        return
      case '$':
      case 'End':
        this.moveCol(Math.max(0, this.text(this.cur.row).length - 1))
        return
      case 'w':
      case 'W':
        for (let i = 0; i < n; i++) this.word(1)
        return
      case 'b':
      case 'B':
        for (let i = 0; i < n; i++) this.word(-1)
        return
      case 'e':
      case 'E':
        for (let i = 0; i < n; i++) this.wordEnd()
        return
      case 'G':
        this.moveRow(hadCount ? n - 1 : this.lastRow())
        return
      case 'g':
      case 'y':
        if (k === 'y' && this.mode !== 'normal') {
          const sel = this.term.getSelection()
          if (sel) copyText(sel)
          this.term.clearSelection()
          if (this.mode === 'visual-line') this.cur = { row: Math.min(this.anchor.row, this.cur.row), col: 0 }
          else if (this.before(this.anchor, this.cur)) this.cur = { ...this.anchor }
          this.setMode('normal')
          this.show()
          return
        }
        this.pending = k
        return
      case 'H':
        this.moveRow(this.buf.viewportY)
        return
      case 'M':
        this.moveRow(this.buf.viewportY + Math.floor(rows / 2))
        return
      case 'L':
        this.moveRow(this.buf.viewportY + rows - 1)
        return
      case 'PageUp':
        this.moveRow(this.cur.row - rows * n)
        return
      case 'PageDown':
        this.moveRow(this.cur.row + rows * n)
        return
      case 'v':
      case 'V': {
        const m = k === 'v' ? 'visual' : 'visual-line'
        if (this.mode === m) {
          this.term.clearSelection()
          this.setMode('normal')
        } else {
          if (this.mode === 'normal') this.anchor = { ...this.cur }
          this.setMode(m)
        }
        this.show()
        return
      }
      case '/':
      case '?':
        this.hooks.prompt(k === '?')
        return
      case 'n':
      case 'N':
        if (this.lastSearch) for (let i = 0; i < n; i++) this.find(this.lastSearch.text, this.lastSearch.back !== (k === 'N'))
        return
    }
  }

  search(text: string, back: boolean) {
    if (!text) return
    this.lastSearch = { text, back }
    this.find(text, back)
  }

  private find(text: string, back: boolean) {
    const fold = text === text.toLowerCase()
    const needle = fold ? text.toLowerCase() : text
    const last = this.lastRow()
    const total = last + 1
    for (let i = 0; i <= total; i++) {
      const row = (((back ? this.cur.row - i : this.cur.row + i) % total) + total) % total
      let line = this.text(row)
      if (fold) line = line.toLowerCase()
      let col: number
      if (back) {
        const before = i === 0 ? this.cur.col - 1 : line.length
        col = before < 0 ? -1 : line.lastIndexOf(needle, before)
      } else {
        col = line.indexOf(needle, i === 0 ? this.cur.col + 1 : 0)
      }
      if (col >= 0) {
        this.cur = { row, col }
        this.want = col
        this.show()
        return
      }
    }
  }

  private word(dir: 1 | -1) {
    let { row, col } = this.cur
    const last = this.lastRow()
    if (dir === 1) {
      let line = this.text(row)
      const start = wordClass(line[col] ?? '')
      while (col < line.length && wordClass(line[col]) === start && start !== 0) col++
      for (;;) {
        while (col < line.length && wordClass(line[col]) === 0) col++
        if (col < line.length || row >= last) break
        row++
        col = 0
        line = this.text(row)
        if (line === '') break
      }
      col = Math.min(col, Math.max(0, line.length - 1))
    } else {
      let line = this.text(row)
      col--
      for (;;) {
        while (col >= 0 && wordClass(line[col]) === 0) col--
        if (col >= 0 || row === 0) break
        row--
        line = this.text(row)
        col = line.length - 1
        if (line === '') {
          col = 0
          break
        }
      }
      if (col > 0) {
        const c = wordClass(line[col])
        while (col > 0 && wordClass(line[col - 1]) === c) col--
      }
      col = Math.max(0, col)
    }
    this.cur = { row, col }
    this.want = col
    this.show()
  }

  private wordEnd() {
    let { row, col } = this.cur
    const last = this.lastRow()
    let line = this.text(row)
    col++
    for (;;) {
      while (col < line.length && wordClass(line[col]) === 0) col++
      if (col < line.length || row >= last) break
      row++
      col = 0
      line = this.text(row)
    }
    if (col < line.length) {
      const c = wordClass(line[col])
      while (col + 1 < line.length && wordClass(line[col + 1]) === c) col++
    }
    this.cur = { row, col: Math.min(col, Math.max(0, line.length - 1)) }
    this.want = this.cur.col
    this.show()
  }

  private moveRow(row: number) {
    const r = Math.max(0, Math.min(row, this.lastRow()))
    const len = this.text(r).length
    this.cur = { row: r, col: Math.min(this.want, Math.max(0, len - 1)) }
    this.show()
  }

  private moveCol(col: number) {
    this.cur = { row: this.cur.row, col: Math.max(0, col) }
    this.want = this.cur.col
    this.show()
  }

  private before(a: Pos, b: Pos) {
    return a.row < b.row || (a.row === b.row && a.col < b.col)
  }

  private keepInView() {
    const b = this.buf
    const top = b.viewportY
    const bottom = top + this.term.rows - 1
    if (this.cur.row < top) this.moveRow(top)
    else if (this.cur.row > bottom) this.moveRow(bottom)
  }

  private show() {
    const b = this.buf
    const rows = this.term.rows
    if (this.cur.row < b.viewportY) this.term.scrollToLine(this.cur.row)
    else if (this.cur.row >= b.viewportY + rows) this.term.scrollToLine(this.cur.row - rows + 1)

    if (this.mode === 'visual' || this.mode === 'visual-line') {
      const [a, z] = this.before(this.cur, this.anchor) ? [this.cur, this.anchor] : [this.anchor, this.cur]
      if (this.mode === 'visual-line') this.term.selectLines(a.row, z.row)
      else this.term.select(a.col, a.row, (z.row - a.row) * this.term.cols + z.col - a.col + 1)
    }

    this.clearCursor()
    const theme = this.term.options.theme ?? {}
    this.marker = this.term.registerMarker(this.cur.row - (b.baseY + b.cursorY))
    if (!this.marker) return
    this.deco = this.term.registerDecoration({
      marker: this.marker,
      x: Math.min(this.cur.col, this.term.cols - 1),
      width: 1,
      backgroundColor: theme.cursor ?? '#ffffff',
      foregroundColor: theme.cursorAccent ?? '#000000',
      layer: 'top',
    })
  }

  private clearCursor() {
    this.deco?.dispose()
    this.marker?.dispose()
    this.deco = undefined
    this.marker = undefined
  }
}
