import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { closePane, closeTab } from '../lib/actions'
import { copyText, errorText, pasteText } from '../lib/bridge'
import { charWidth } from '../lib/metrics'
import { register } from '../lib/panes'
import { basename } from '../lib/paths'
import { currentTheme } from '../lib/settings'
import * as S from '../lib/store'
import { openShell, type Shell } from '../lib/terminals'
import { TermVim } from '../lib/termVim'
import { xtermTheme } from '../lib/themes'

type Props = { id: string; tabId: string; cwd: string; active: boolean; centered: boolean }

export default function TerminalPane({ id, tabId, cwd, active, centered }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const vimRef = useRef<TermVim | null>(null)
  const [prompt, setPrompt] = useState<{ back: boolean } | null>(null)
  const tabRef = useRef(tabId)
  tabRef.current = tabId
  const fontSize = S.useStore((s) => s.settings.fontSize)
  const fontFamily = S.useStore((s) => s.settings.fontFamily)
  const maxColumns = S.useStore((s) => s.settings.maxColumns)
  const project = S.useProjectId()

  useEffect(() => {
    const settings = S.get().settings
    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      theme: xtermTheme(currentTheme()),
      cursorBlink: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      allowProposedApi: true,
      drawBoldTextInBrightColors: false,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
    }

    let shell: Shell | null = null
    let state: 'starting' | 'running' | 'exited' | 'dead' = 'starting'
    const proj = () => S.project(project)
    let session = proj()?.session ?? 0
    let title = ''
    let shellName = ''
    let disposed = false

    const status = () =>
      S.setPaneStatus(id, { mode: vim.mode, items: [title && !title.startsWith('term://') ? title : shellName] })

    const doFit = () => {
      const el = host.current
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
      }
    }

    const start = async () => {
      state = 'starting'
      session = proj()?.session ?? 0
      doFit()
      try {
        const sh = await openShell(project, term.cols, term.rows, cwd, {
          data: (bytes) => term.write(bytes),
          exit: (code) => {
            if (state !== 'running') return
            state = 'exited'
            term.write(`\r\n\x1b[2m[Process exited ${code}]\x1b[0m`)
          },
        })
        if (disposed) {
          sh.close()
          return
        }
        shell = sh
        shellName = basename(sh.shell)
        state = 'running'
        status()
      } catch (err) {
        state = 'dead'
        term.write(`\r\n\x1b[31mCouldn't start a shell: ${errorText(err)}\x1b[0m\r\n\x1b[2m[Press any key to try again]\x1b[0m`)
      }
    }

    const unsub = S.subscribe(() => {
      const s = proj()
      if (!s) return
      if (state === 'running' && (s.session !== session || s.conn.state === 'lost')) {
        state = 'dead'
        shell = null
        term.write('\r\n\x1b[2m[Disconnected]\x1b[0m')
      }
      if (state === 'dead' && s.conn.state === 'connected' && s.session !== session) {
        term.write('\x1b[2m  Press any key for a new shell\x1b[0m')
        session = s.session
      }
    })

    const onKey = () => {
      if (state === 'exited') {
        if (id === tabRef.current) closeTab(id)
        else closePane(tabRef.current, id)
        return true
      }
      if (state === 'dead') {
        if (proj()?.conn.state === 'connected') {
          term.reset()
          start()
        }
        return true
      }
      return false
    }

    const vim = new TermVim(term, {
      send: (data) => {
        if (!onKey()) shell?.write(data)
      },
      changed: () => status(),
      prompt: (back) => setPrompt({ back }),
    })
    vimRef.current = vim

    const subs = [
      term.onData((data) => {
        if (vim.mode !== 'terminal' || onKey()) return
        shell?.write(data)
      }),
      term.onBinary((data) => {
        if (vim.mode !== 'terminal' || onKey()) return
        shell?.writeBinary(data)
      }),
      term.onResize(({ cols, rows }) => shell?.resize(cols, rows)),
      term.onTitleChange((t) => {
        title = t
        status()
      }),
      term.onSelectionChange(() => {
        if (vim.mode === 'terminal' && term.hasSelection()) copyText(term.getSelection())
      }),
    ]

    term.attachCustomKeyEventHandler((e) => {
      if (!vim.key(e)) return false
      if (e.type !== 'keydown' || S.isMac() || !e.ctrlKey || e.altKey || e.metaKey) return true
      if (e.shiftKey && vim.mode === 'terminal' && /^Key[A-Z]$/.test(e.code)) {
        e.preventDefault()
        if (!onKey()) shell?.write(String.fromCharCode(e.code.charCodeAt(3) - 64))
        return false
      }
      if (e.code === 'KeyV' && !e.shiftKey) {
        e.preventDefault()
        pasteText().then((text) => text && term.paste(text))
        return false
      }
      if (e.code === 'KeyC' && !e.shiftKey && term.hasSelection()) {
        copyText(term.getSelection())
        term.clearSelection()
        return false
      }
      return true
    })

    const observer = new ResizeObserver(() => doFit())
    observer.observe(host.current!)
    const unsubTheme = S.subscribe(() => {
      const theme = xtermTheme(currentTheme())
      if (term.options.theme?.background !== theme.background || term.options.theme?.foreground !== theme.foreground) term.options.theme = theme
    })

    const unregister = register(id, { focus: () => term.focus(), shellInput: () => vim.mode === 'terminal' })
    start()

    return () => {
      disposed = true
      unregister()
      unsub()
      unsubTheme()
      observer.disconnect()
      subs.forEach((s) => s.dispose())
      vim.dispose()
      vimRef.current = null
      shell?.close()
      term.dispose()
      termRef.current = null
      S.set((s) => {
        const status = { ...s.status }
        delete status[id]
        return { status }
      })
    }
  }, [id])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    term.options.fontFamily = fontFamily
  }, [fontSize, fontFamily])

  useEffect(() => {
    if (active) requestAnimationFrame(() => termRef.current?.focus())
  }, [active])

  const [, setFontsReady] = useState(0)
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1))
  }, [])

  const width = Math.ceil(maxColumns * charWidth(fontFamily, fontSize) + charWidth(fontFamily, fontSize) + 14)
  return (
    <div className={`pane-inner ${centered ? 'centered' : ''}`} style={centered ? { maxWidth: width } : undefined}>
      <div ref={host} className="term-host" />
      {prompt && (
        <input
          className="term-search"
          autoFocus
          spellCheck={false}
          placeholder={prompt.back ? '?' : '/'}
          onBlur={() => setPrompt(null)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== 'Escape') return
            e.preventDefault()
            if (e.key === 'Enter') vimRef.current?.search(e.currentTarget.value, prompt.back)
            setPrompt(null)
            termRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
