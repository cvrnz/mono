import { Button, Spinner } from '@heroui/react'
import { initVimMode, type VimAdapterInstance } from 'monaco-vim'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '../lib/bridge'
import { toast } from '../lib/dialogs'
import { monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import { useParts } from '../lib/parts'
import * as sql from '../lib/sql'
import * as S from '../lib/store'
import { setupVim } from '../lib/vim'
import { useHints } from './Hints'
import SqlGrid from './SqlGrid'

type Props = { tab: S.SqlTab; active: boolean }

const none: S.SqlConnection[] = []
const rowCount = (n: number) => `${n.toLocaleString()} row${n === 1 ? '' : 's'}`

function modeOf(ev: { mode: string; subMode?: string }) {
  if (ev.mode === 'visual') return ev.subMode === 'linewise' ? 'visual-line' : ev.subMode === 'blockwise' ? 'visual-block' : 'visual'
  return ev.mode
}

export default function SqlPane({ tab, active }: Props) {
  const [id] = useState(sql.newSqlId)
  const saved = S.useStore((s) => s.settings.sqlConnections) ?? none
  const settings = S.useStore((s) => s.settings)
  const { vim, fontSize, fontFamily, lineNumbers } = settings

  const [current, setCurrent] = useState<S.SqlConnection | null>(null)
  const [info, setInfo] = useState<sql.Info | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connError, setConnError] = useState('')
  const [asked, setAsked] = useState(0)

  const [outcome, setOutcome] = useState<sql.Outcome | null>(null)
  const [ran, setRan] = useState('')
  const [running, setRunning] = useState(false)
  const [shown, setShown] = useState(0)
  const [split, setSplit] = useState(0.45)
  const [loaded, setLoaded] = useState(false)

  const right = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const vimNode = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modeRef = useRef('normal')
  const infoRef = useRef(info)
  infoRef.current = info
  const runningRef = useRef(running)
  runningRef.current = running
  const runRef = useRef<(text?: string, offset?: number) => void>(() => {})
  const outcomeRef = useRef(outcome)
  outcomeRef.current = outcome
  const shownRef = useRef(shown)
  shownRef.current = shown

  const status = useCallback(() => {
    const items: string[] = []
    const i = infoRef.current
    if (i) items.push(`${sql.engineNames[i.engine]}${i.database ? ' · ' + i.database : ''}`)
    else items.push('Not connected')
    const o = outcomeRef.current
    if (o) {
      const set = o.results[shownRef.current]
      if (set?.columns.length) items.push(rowCount(set.rows.length) + (set.truncated ? ' (more not shown)' : ''))
      items.push(`${o.ms.toLocaleString()} ms`)
    }
    S.setPaneStatus(tab.id, { mode: S.get().settings.vim ? modeRef.current : 'insert', items })
  }, [tab.id])
  useEffect(status, [status, info, outcome, shown])

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, {
      automaticLayout: true,
      fontFamily: S.get().settings.fontFamily,
      fontSize: S.get().settings.fontSize,
      lineNumbers: S.get().settings.lineNumbers ? 'on' : 'off',
      lineDecorationsWidth: '2ch',
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      stickyScroll: { enabled: false },
      guides: { indentation: false },
      occurrencesHighlight: 'off',
      renderWhitespace: 'none',
      contextmenu: true,
      fixedOverflowWidgets: true,
      padding: { top: 4 },
      cursorSurroundingLines: 3,
      smoothScrolling: false,
    })
    const uri = monaco.Uri.from({ scheme: 'sql', path: `/${tab.id}.sql` })
    const model = monaco.editor.createModel(tab.text ?? '', 'sql', uri)
    editor.setModel(model)
    editorRef.current = editor

    let timer = 0
    const subs = [
      model.onDidChangeContent(() => {
        clearTimeout(timer)
        timer = window.setTimeout(() => S.updateTab(tab.id, { text: model.getValue() }), 400)
        monaco.editor.setModelMarkers(model, 'sql', [])
      }),
      editor.onDidFocusEditorText(status),
    ]
    editor.addAction({
      id: 'mono.sql.run',
      label: 'Run Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      run: () => runRef.current(),
    })
    setLoaded(true)
    return () => {
      clearTimeout(timer)
      S.updateTab(tab.id, { text: model.getValue() })
      subs.forEach((s) => s.dispose())
      editor.dispose()
      model.dispose()
      editorRef.current = null
      S.set((s) => {
        const st = { ...s.status }
        delete st[tab.id]
        return { status: st }
      })
    }
  }, [tab.id])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !loaded) return
    if (!vim) {
      modeRef.current = 'insert'
      status()
      return
    }
    setupVim()
    const adapter: VimAdapterInstance = initVimMode(editor, vimNode.current)
    modeRef.current = 'normal'
    adapter.on('vim-mode-change', (ev: { mode: string; subMode?: string }) => {
      modeRef.current = modeOf(ev)
      status()
    })
    status()
    return () => {
      adapter.dispose()
      modeRef.current = 'insert'
    }
  }, [vim, loaded, status])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, fontFamily, lineNumbers: lineNumbers ? 'on' : 'off' })
  }, [fontSize, fontFamily, lineNumbers])

  useEffect(() => () => void sql.disconnect(id), [id])

  const focusEditor = () => requestAnimationFrame(() => editorRef.current?.focus())

  const open = useCallback(
    async (c: S.SqlConnection) => {
      setConnecting(true)
      setConnError('')
      try {
        const i = await sql.connect(id, c)
        setInfo(i)
        infoRef.current = i
        setCurrent(c)
        S.updateTab(tab.id, { conn: c.name })
        return i
      } catch (err) {
        setInfo(null)
        infoRef.current = null
        setConnError(errorText(err))
      } finally {
        setConnecting(false)
      }
    },
    [id, tab.id],
  )

  useEffect(() => {
    const c = S.get().settings.sqlConnections?.find((x) => x.name === tab.conn)
    if (c) open(c)
  }, [])

  /** Switches the tab to another saved connection. */
  const use = async (name: string) => {
    const c = saved.find((x) => x.name === name)
    if (!c || c.name === current?.name) return
    if (runningRef.current) await sql.cancel(id).catch(() => {})
    setOutcome(null)
    if (await open(c)) focusEditor()
  }

  const run = async (given?: string) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || runningRef.current) return
    if (!infoRef.current) {
      toast(saved.length ? 'Pick a connection first' : 'Add a connection in the Database sidebar first')
      return
    }
    let text = given ?? ''
    let offset = -1
    if (given === undefined) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        text = model.getValueInRange(sel)
        offset = model.getOffsetAt(sel.getStartPosition())
      } else {
        text = model.getValue()
        offset = 0
      }
    }
    if (!text.trim()) return
    monaco.editor.setModelMarkers(model, 'sql', [])
    setRunning(true)
    setRan(given ?? '')
    try {
      const o = await sql.query(id, text)
      setOutcome(o)
      const firstRows = o.results.findIndex((r) => r.columns.length > 0)
      setShown(o.error || firstRows < 0 ? o.results.length : firstRows)
      if (o.error && o.position && offset >= 0) {
        const at = model.getPositionAt(offset + o.position - 1)
        const word = model.getWordAtPosition(at)
        monaco.editor.setModelMarkers(model, 'sql', [
          {
            severity: monaco.MarkerSeverity.Error,
            message: o.error,
            startLineNumber: at.lineNumber,
            startColumn: word?.startColumn ?? at.column,
            endLineNumber: at.lineNumber,
            endColumn: word?.endColumn ?? at.column + 1,
          },
        ])
        editor.setPosition(at)
        editor.revealPositionInCenterIfOutsideViewport(at)
      }
    } catch (err) {
      setOutcome({ results: [], error: errorText(err), ms: 0 })
      setShown(0)
      if (/not connected/i.test(errorText(err))) setInfo(null)
    } finally {
      setRunning(false)
    }
  }
  runRef.current = run

  const cancelRun = () => {
    sql.cancel(id).catch((err) => toast(errorText(err), 'error'))
  }

  const insert = (name: string) => {
    const editor = editorRef.current
    if (!editor) return
    const sel = editor.getSelection()
    if (sel) editor.executeEdits('sql', [{ range: sel, text: name, forceMoveMarkers: true }])
    editor.focus()
  }

  /** Reconnects with this database as the default one for queries. */
  const switchDatabase = async (db: string) => {
    if (!current || !info || db === sql.currentDatabase(info) || info.engine === 'sqlite') return infoRef.current
    const i = await open({ ...current, database: db })
    if (i) toast(`Using ${db}`)
    return i
  }

  useEffect(() => sql.onRequest(() => setAsked((n) => n + 1)), [])

  useEffect(() => {
    if (!loaded || !info || connecting) return
    const r = sql.takeRequest(tab.id)
    if (!r) return
    void (async () => {
      if (r.database) await switchDatabase(r.database)
      else if (typeof r.insert === 'string') insert(r.insert)
      else if (r.insert) insert(sql.objectName(info, r.insert.db, r.insert.obj))
      else if (r.select) {
        const { db, obj } = r.select
        // Postgres can't query another database over the same connection.
        const i = info.engine === 'postgres' ? await switchDatabase(db) : info
        if (i) run(sql.selectTop(i, sql.objectName(i, db, obj)))
      }
    })()
  }, [asked, loaded, info, connecting])

  useEffect(() => {
    if (!active || !loaded) return
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [active, loaded])

  const { part, setPart, list: parts, nav } = useParts('editor')
  const results = useRef<HTMLDivElement>(null)
  parts.current = [
    { name: 'editor', focus: () => editorRef.current?.focus() },
    { name: 'results', focus: () => results.current?.querySelector<HTMLElement>('.sql-grid, .sql-messages')?.focus() },
  ]

  useEffect(() => register(tab.id, {
    focus: () => editorRef.current?.focus(),
    editor: editorRef.current ?? undefined,
    ...nav,
  }), [tab.id, loaded, nav])

  const drag = (e: React.MouseEvent) => {
    e.preventDefault()
    const box = right.current!.getBoundingClientRect()
    const onMove = (ev: MouseEvent) => setSplit(Math.min(0.85, Math.max(0.12, (ev.clientY - box.top) / box.height)))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'row-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const sets = outcome?.results ?? []
  const set = sets[shown]
  const messages = outcome
    ? [
        ...sets.map((s, i) => {
          if (s.columns.length) return `Result ${i + 1}: ${s.truncated ? `the first ${rowCount(s.rows.length)} (there are more)` : rowCount(s.rows.length)}`
          const what = s.command ?? 'Done'
          return s.affected !== undefined ? `${what}: ${rowCount(s.affected)} affected` : what
        }),
        ...(outcome.notices ?? []),
        `Took ${outcome.ms.toLocaleString()} ms`,
      ]
    : []

  const hints =
    part === 'results'
      ? set?.columns.length
        ? ['h/j/k/l move', 'g/G first/last row', '0/$ first/last column', 'y copy cell', 'Y copy row']
        : ['↑/↓ scroll', 'select and copy text']
      : [`${S.isMac() ? '⌘' : 'Ctrl+'}Enter run the selection, or everything`]
  useHints(tab.id, hints)

  return (
    <div className="sql">
      <div className="sql-main" ref={right}>
        <div className="sql-editor" style={{ height: `${split * 100}%` }} onFocus={() => setPart('editor')}>
          <div className="sql-toolbar">
            <select
              className="text-input sql-conn"
              value={current?.name ?? tab.conn ?? ''}
              title={info ? `${info.version}\n${info.user}` : connError || undefined}
              onChange={(e) => use(e.target.value)}
            >
              {!current && !tab.conn && <option value="">Pick a connection</option>}
              {tab.conn && !saved.some((c) => c.name === tab.conn) && <option value={tab.conn}>{tab.conn} (deleted)</option>}
              {saved.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            {connecting && <Spinner size="sm" />}
            <Button size="sm" variant="primary" isDisabled={!info || running} onPress={() => run()}>
              Run
            </Button>
            <Button size="sm" variant="secondary" isDisabled={!running} onPress={cancelRun}>
              Cancel
            </Button>
            <span className="desc">{S.isMac() ? '⌘' : 'Ctrl+'}Enter runs the selection, or everything</span>
          </div>
          <div className="sql-editor-host">
            <div ref={host} style={{ position: 'absolute', inset: 0 }} />
          </div>
          <div ref={vimNode} className="vim-status sql-vim" />
        </div>
        <div className="sql-splitter" onMouseDown={drag} />
        <div className="sql-results" ref={results} onFocus={() => setPart('results')}>
          {running && (
            <div className="sql-running">
              <Spinner size="sm" /> Running{ran ? ` ${ran}` : '…'}
            </div>
          )}
          {!running && !outcome && (
            <div className={`sql-empty ${connError ? 'sql-bad' : ''}`}>
              {info ? 'Results show here.' : connecting ? 'Connecting…' : connError || (saved.length ? 'Pick a connection above.' : `Add a connection in the Database sidebar (${S.isMac() ? '⌘' : 'Ctrl+'}D).`)}
            </div>
          )}
          {!running && outcome && (
            <>
              <div className="sql-tabs">
                {sets.map((s, i) =>
                  s.columns.length ? (
                    <div key={i} className={`sql-tab ${i === shown ? 'on' : ''}`} onMouseDown={() => setShown(i)}>
                      Result {sets.filter((x) => x.columns.length).indexOf(s) + 1}
                      <span className="desc"> ({s.rows.length.toLocaleString()}{s.truncated ? '+' : ''})</span>
                    </div>
                  ) : null,
                )}
                <div className={`sql-tab ${shown >= sets.length || !set?.columns.length ? 'on' : ''}`} onMouseDown={() => setShown(sets.length)}>
                  Messages{outcome.error && <span className="sql-bad"> ●</span>}
                </div>
              </div>
              {set?.columns.length ? (
                <SqlGrid set={set} />
              ) : (
                <div className="sql-messages" tabIndex={0}>
                  {outcome.error && <div className="sql-error">{outcome.error}</div>}
                  {messages.map((m, i) => (
                    <div key={i}>{m}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
