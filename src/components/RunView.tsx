import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/bridge'
import { register } from '../lib/panes'
import * as R from '../lib/runs'
import { currentTheme } from '../lib/settings'
import * as S from '../lib/store'
import { xtermTheme } from '../lib/themes'
import TermFind from './TermFind'

export const runViewPane = 'run-view'

/** A run's output: the terminal it ran in, read-only, over the panes and without a tab. */
export default function RunView({ id }: { id: string }) {
  const run = S.useStore((s) => s.runs.find((r) => r.id === id))
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [finding, setFinding] = useState(false)
  const fontSize = S.useStore((s) => s.settings.fontSize)
  const fontFamily = S.useStore((s) => s.settings.fontFamily)

  useEffect(() => {
    const settings = S.get().settings
    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      theme: xtermTheme(currentTheme()),
      allowTransparency: true,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: 'none',
      scrollback: 50000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: false,
    })
    termRef.current = term
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    searchRef.current = search
    term.open(host.current!)
    const doFit = () => {
      const el = host.current
      if (!el || el.clientWidth === 0) return
      try {
        fit.fit()
      } catch {
      }
    }
    doFit()
    R.resize(id, term.cols, term.rows)
    const stop = R.watch(id, (b) => term.write(b))
    const subs = [
      term.onResize(({ cols, rows }) => R.resize(id, cols, rows)),
      term.onSelectionChange(() => term.hasSelection() && copyText(term.getSelection())),
    ]
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.key === 'Escape') {
        R.show(null)
        return false
      }
      return true
    })
    const observer = new ResizeObserver(doFit)
    observer.observe(host.current!)
    const unregister = register(runViewPane, { focus: () => term.focus(), find: () => setFinding(true) })
    requestAnimationFrame(() => term.focus())
    return () => {
      unregister()
      observer.disconnect()
      subs.forEach((s) => s.dispose())
      stop()
      term.dispose()
      termRef.current = null
    }
  }, [id])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    term.options.fontFamily = fontFamily
  }, [fontSize, fontFamily])

  if (!run) return null
  const going = run.state === 'running' || run.state === 'starting'
  return (
    <div className="run-view">
      <div className="run-view-head">
        <span className={`run-dot ${going ? 'running' : run.state}`} />
        <span className="run-view-name">{run.name}</span>
        <span className="desc">{run.command}</span>
        <span className="run-view-state">{going ? 'running' : run.state === 'stopped' ? 'stopped' : `exited ${run.code ?? ''}`}</span>
        {going ? (
          <span className="run-btn" onMouseDown={(e) => (e.preventDefault(), R.stop(id))}>
            Stop
          </span>
        ) : (
          <span className="run-btn" onMouseDown={(e) => (e.preventDefault(), R.rerun(id))}>
            Run again
          </span>
        )}
        <span className="run-btn" title="Close (Esc)" onMouseDown={(e) => (e.preventDefault(), R.show(null))}>
          ✕
        </span>
      </div>
      <div className="run-view-body">
        <div ref={host} className="term-host" />
        {finding && termRef.current && searchRef.current && <TermFind term={termRef.current} search={searchRef.current} onClose={() => setFinding(false)} />}
      </div>
    </div>
  )
}
