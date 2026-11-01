import { Button, Spinner } from '@heroui/react'
import { initVimMode, type VimAdapterInstance } from 'monaco-vim'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { copyText, errorText } from '../lib/bridge'
import { confirm, toast } from '../lib/dialogs'
import { monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import { useParts } from '../lib/parts'
import { updateSettings } from '../lib/settings'
import * as sql from '../lib/sql'
import * as S from '../lib/store'
import { setupVim } from '../lib/vim'
import Hints from './Hints'
import SideSplitter, { sideStyle, useSideWidth } from './SideSplitter'
import SqlGrid from './SqlGrid'

type Props = { tab: S.SqlTab; active: boolean }

type Row =
  | { kind: 'conn'; conn: S.SqlConnection }
  | { kind: 'new' }
  | { kind: 'schema'; schema: string; count: number }
  | { kind: 'table'; table: sql.Table; depth: number }
  | { kind: 'column'; column: sql.Column; depth: number }
  | { kind: 'note'; text: string; depth: number }

const engines = Object.keys(sql.engineNames) as S.SqlEngine[]
const mainSchemas = new Set(['public', 'dbo', 'main'])
const none: S.SqlConnection[] = []
const rowCount = (n: number) => `${n.toLocaleString()} row${n === 1 ? '' : 's'}`
const tableKey = (t: sql.Table) => `${t.schema}\u0000${t.name}`

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
  const [form, setForm] = useState<{ conn: S.SqlConnection; was?: string } | null>(null)

  const [tables, setTables] = useState<sql.Table[] | null>(null)
  const [tablesError, setTablesError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [columns, setColumns] = useState<Map<string, sql.Column[] | string>>(new Map())
  const [cursor, setCursor] = useState(0)

  const [outcome, setOutcome] = useState<sql.Outcome | null>(null)
  const [ran, setRan] = useState('')
  const [running, setRunning] = useState(false)
  const [shown, setShown] = useState(0)
  const [split, setSplit] = useState(0.45)
  const [loaded, setLoaded] = useState(false)

  const side = useRef<HTMLDivElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const sideWidth = useSideWidth('sql')
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
      id: 'monomyth.sql.run',
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

  const loadTables = useCallback(async () => {
    setTablesError('')
    try {
      const list = await sql.tables(id)
      setTables(list)
      setColumns(new Map())
      const schemas = [...new Set(list.map((t) => t.schema))]
      const main = schemas.find((s) => mainSchemas.has(s) || s === infoRef.current?.database) ?? schemas[0]
      setExpanded(new Set(main !== undefined ? [`s:${main}`] : []))
    } catch (err) {
      setTables([])
      setTablesError(errorText(err))
    }
  }, [id])

  const focusEditor = () => requestAnimationFrame(() => editorRef.current?.focus())

  const open = useCallback(
    async (c: S.SqlConnection) => {
      setConnecting(true)
      setConnError('')
      try {
        const i = await sql.connect(id, c)
        setInfo(i)
        setCurrent(c)
        setForm(null)
        setOutcome(null)
        setTables(null)
        setCursor(0)
        S.updateTab(tab.id, { conn: c.name || undefined })
        loadTables()
        focusEditor()
      } catch (err) {
        setConnError(errorText(err))
        setForm((f) => f ?? { conn: c, was: saved.some((x) => x.name === c.name) ? c.name : undefined })
      } finally {
        setConnecting(false)
      }
    },
    [id, tab.id, loadTables, saved],
  )

  useEffect(() => {
    if (!tab.conn) return
    const c = S.get().settings.sqlConnections?.find((x) => x.name === tab.conn)
    if (c) open(c)
  }, [])

  const close = async () => {
    if (runningRef.current) await sql.cancel(id).catch(() => {})
    await sql.disconnect(id)
    setInfo(null)
    setCurrent(null)
    setTables(null)
    setOutcome(null)
    setCursor(0)
    S.updateTab(tab.id, { conn: undefined })
    requestAnimationFrame(() => side.current?.focus())
  }

  const run = async (given?: string) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || runningRef.current) return
    if (!infoRef.current) {
      toast('Connect to a database first')
      side.current?.focus()
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
      if (/not connected/i.test(errorText(err))) {
        setInfo(null)
        setTables(null)
      }
    } finally {
      setRunning(false)
    }
  }
  runRef.current = run

  const cancelRun = () => {
    sql.cancel(id).catch((err) => toast(errorText(err), 'error'))
  }

  const save = (c: S.SqlConnection, was?: string): boolean => {
    const name = c.name.trim()
    if (!name) return true
    const list = S.get().settings.sqlConnections ?? []
    if (name !== was && list.some((x) => x.name === name)) {
      toast(`There's already a connection called ${name}`, 'error')
      return false
    }
    const clean = { ...c, name }
    const i = list.findIndex((x) => x.name === (was ?? name))
    updateSettings({ sqlConnections: i >= 0 ? list.map((x, j) => (j === i ? clean : x)) : [...list, clean] })
    return true
  }

  const remove = async (c: S.SqlConnection) => {
    if (!(await confirm(`Delete the connection ${c.name}?`, undefined, 'Delete', true))) return
    updateSettings({ sqlConnections: (S.get().settings.sqlConnections ?? []).filter((x) => x.name !== c.name) })
    setForm(null)
    side.current?.focus()
  }

  const newForm = () => {
    setConnError('')
    setForm({ conn: { name: '', engine: 'postgres', host: 'localhost', port: sql.defaultPorts.postgres } })
  }

  const loadColumns = async (t: sql.Table) => {
    const key = tableKey(t)
    if (columns.has(key)) return
    try {
      const list = await sql.columns(id, t.schema, t.name)
      setColumns((m) => new Map(m).set(key, list))
    } catch (err) {
      setColumns((m) => new Map(m).set(key, errorText(err)))
    }
  }

  const rows: Row[] = useMemo(() => {
    if (!info) return [...saved.map((conn): Row => ({ kind: 'conn', conn })), { kind: 'new' }]
    if (!tables) return []
    const out: Row[] = []
    const schemas = [...new Set(tables.map((t) => t.schema))]
    const grouped = schemas.length > 1
    const addTable = (t: sql.Table, depth: number) => {
      out.push({ kind: 'table', table: t, depth })
      const key = tableKey(t)
      if (!expanded.has(`t:${key}`)) return
      const cols = columns.get(key)
      if (cols === undefined) out.push({ kind: 'note', text: 'Loading…', depth: depth + 1 })
      else if (typeof cols === 'string') out.push({ kind: 'note', text: cols, depth: depth + 1 })
      else for (const column of cols) out.push({ kind: 'column', column, depth: depth + 1 })
    }
    for (const schema of schemas) {
      const list = tables.filter((t) => t.schema === schema)
      if (grouped) {
        out.push({ kind: 'schema', schema, count: list.length })
        if (!expanded.has(`s:${schema}`)) continue
      }
      for (const t of list) addTable(t, grouped ? 1 : 0)
    }
    return out
  }, [info, tables, saved, expanded, columns])

  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  const row = rows[at] as Row | undefined

  const toggle = (key: string, on?: boolean) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (on ?? !next.has(key)) next.add(key)
      else next.delete(key)
      return next
    })

  const insert = (name: string) => {
    const editor = editorRef.current
    if (!editor) return
    const sel = editor.getSelection()
    if (sel) editor.executeEdits('sql', [{ range: sel, text: name, forceMoveMarkers: true }])
    editor.focus()
  }

  const nameOf = (r: Row | undefined): string | null => {
    if (!info || !r) return null
    if (r.kind === 'table') return sql.tableName(info, r.table)
    if (r.kind === 'column') return sql.quoteName(info.engine, r.column.name)
    if (r.kind === 'schema') return sql.quoteName(info.engine, r.schema)
    return null
  }

  const choose = (r: Row | undefined) => {
    if (!r) return
    if (r.kind === 'conn') open(r.conn)
    else if (r.kind === 'new') newForm()
    else if (r.kind === 'schema') toggle(`s:${r.schema}`)
    else if (r.kind === 'table' && info) run(sql.selectTop(info, r.table))
    else if (r.kind === 'column') insert(nameOf(r)!)
  }

  const parentIndex = (i: number): number => {
    const r = rows[i]
    const depth = r && 'depth' in r ? r.depth : 0
    for (let j = i - 1; j >= 0; j--) {
      const p = rows[j]
      const d = p.kind === 'schema' ? -1 : 'depth' in p ? p.depth : 0
      if (d < depth) return j
    }
    return i
  }

  const onSideKey = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    const move = (n: number) => setCursor(Math.max(0, Math.min(rows.length - 1, n)))
    if (k === 'j' || k === 'ArrowDown') move(at + 1)
    else if (k === 'k' || k === 'ArrowUp') move(at - 1)
    else if (k === 'g' || k === 'Home') move(0)
    else if (k === 'G' || k === 'End') move(rows.length - 1)
    else if (k === 'Enter' || k === 'o') choose(row)
    else if (!info && k === 'a') newForm()
    else if (!info && k === 'e' && row?.kind === 'conn') {
      setConnError('')
      setForm({ conn: row.conn, was: row.conn.name })
    } else if (!info && k === 'd' && row?.kind === 'conn') remove(row.conn)
    else if (info && (k === 'l' || k === 'ArrowRight')) {
      if (row?.kind === 'schema') toggle(`s:${row.schema}`, true)
      else if (row?.kind === 'table') {
        toggle(`t:${tableKey(row.table)}`, true)
        loadColumns(row.table)
      }
    } else if (info && (k === 'h' || k === 'ArrowLeft')) {
      if (row?.kind === 'schema' && expanded.has(`s:${row.schema}`)) toggle(`s:${row.schema}`, false)
      else if (row?.kind === 'table' && expanded.has(`t:${tableKey(row.table)}`)) toggle(`t:${tableKey(row.table)}`, false)
      else move(parentIndex(at))
    } else if (info && k === 'i' && nameOf(row)) insert(nameOf(row)!)
    else if (info && k === 'y' && nameOf(row)) copyText(nameOf(row)!).then(() => toast(`Copied ${nameOf(row)}`))
    else if (info && k === 'R') loadTables()
    else return
    e.preventDefault()
  }

  useEffect(() => {
    side.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [at, rows])

  useEffect(() => {
    if (!active || !loaded) return
    requestAnimationFrame(() => {
      if (form) return
      if (infoRef.current || connecting) editorRef.current?.focus()
      else side.current?.focus()
    })
  }, [active, loaded])

  const { part, setPart, list: parts, nav } = useParts('side')
  const results = useRef<HTMLDivElement>(null)
  parts.current = [
    { name: 'side', focus: () => side.current?.focus() },
    ...(form
      ? [{ name: 'form', focus: () => right.current?.querySelector<HTMLElement>('.sql-form input, .sql-form select')?.focus() }]
      : [
          { name: 'editor', focus: () => editorRef.current?.focus() },
          { name: 'results', focus: () => results.current?.querySelector<HTMLElement>('.sql-grid, .sql-messages')?.focus() },
        ]),
  ]

  useEffect(() => register(tab.id, {
    focus: () => (infoRef.current ? editorRef.current?.focus() : side.current?.focus()),
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

  const rowLabel = (r: Row) => {
    const pad = '  '.repeat('depth' in r ? r.depth : 0)
    switch (r.kind) {
      case 'conn':
        return (
          <>
            {'  '}
            <span className="sql-conn-name">{r.conn.name}</span>
            <span className="desc">  {sql.engineNames[r.conn.engine]} · {sql.describe(r.conn)}</span>
          </>
        )
      case 'new':
        return <span className="desc">  + New connection</span>
      case 'schema':
        return (
          <>
            {expanded.has(`s:${r.schema}`) ? '▾ ' : '▸ '}
            <span className="sql-schema">{r.schema}</span>
            <span className="desc">  {r.count}</span>
          </>
        )
      case 'table':
        return (
          <>
            {pad}
            {expanded.has(`t:${tableKey(r.table)}`) ? '▾ ' : '▸ '}
            <span className={r.table.view ? 'sql-view' : 'sql-table'}>{r.table.name}</span>
            {r.table.view && <span className="desc">  view</span>}
          </>
        )
      case 'column':
        return (
          <>
            {pad}
            {'  '}
            <span className={r.column.key ? 'sql-key' : undefined}>{r.column.name}</span>
            <span className="desc">
              {'  '}
              {r.column.type}
              {r.column.nullable ? '' : ' not null'}
              {r.column.key ? ' · key' : ''}
            </span>
          </>
        )
      case 'note':
        return <span className="desc">{pad}  {r.text}</span>
    }
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
    part === 'form'
      ? ['Enter connect', 'Tab next field', 'Esc cancel']
      : part === 'editor'
        ? [`${S.isMac() ? '⌘' : 'Ctrl+'}Enter run the selection, or everything`]
        : part === 'results'
          ? set?.columns.length
            ? ['h/j/k/l move', 'g/G first/last row', '0/$ first/last column', 'y copy cell', 'Y copy row']
            : ['↑/↓ scroll', 'select and copy text']
          : info
            ? ['j/k move', 'Enter first 100 rows', 'l/h expand/collapse', 'i insert name', 'y copy name', 'R refresh']
            : ['j/k move', 'Enter connect', 'a new', 'e edit', 'd delete']

  return (
    <div className="sql">
      <div className="sql-body">
      <div className="sql-side" ref={side} tabIndex={0} onKeyDown={onSideKey} onFocus={() => setPart('side')} style={sideStyle(sideWidth)}>
        <div className="sql-title">
          {info ? (
            <>
              <span className="sql-title-name" title={`${info.version}\n${info.user}`}>
                {current?.name || sql.engineNames[info.engine]}
                <span className="desc">  {info.database || sql.describe(current!)}</span>
              </span>
              <span className="sql-title-x" title="Disconnect" onMouseDown={(e) => e.preventDefault()} onClick={close}>
                ✕
              </span>
            </>
          ) : (
            'Connections'
          )}
        </div>
        <div className="sql-rows">
          {connecting && (
            <div className="row desc">
              <Spinner size="sm" /> Connecting…
            </div>
          )}
          {info && !tables && !tablesError && <div className="row desc">  Loading…</div>}
          {tablesError && <div className="row sql-bad">  {tablesError}</div>}
          {info && tables?.length === 0 && !tablesError && <div className="row desc">  No tables</div>}
          {rows.map((r, i) => (
            <div
              key={i}
              className={`row ${i === at ? 'selected' : ''}`}
              onMouseDown={() => setCursor(i)}
              onClick={() => {
                if (r.kind === 'schema') toggle(`s:${r.schema}`)
                else if (r.kind === 'table') {
                  toggle(`t:${tableKey(r.table)}`)
                  loadColumns(r.table)
                } else if (r.kind === 'new') newForm()
              }}
              onDoubleClick={() => r.kind !== 'schema' && r.kind !== 'new' && choose(r)}
              title={r.kind === 'note' ? r.text : undefined}
            >
              {rowLabel(r)}
            </div>
          ))}
        </div>
      </div>
      <SideSplitter side="sql" target={side} />
      <div className="sql-main" ref={right}>
        <div className="sql-editor" style={{ height: `${split * 100}%` }} onFocus={() => setPart('editor')}>
          <div className="sql-toolbar">
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
          {!running && !outcome && <div className="sql-empty">{info ? 'Results show here.' : 'Not connected.'}</div>}
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
        {form && (
          <ConnectionForm
            key={form.was ?? 'new'}
            initial={form.conn}
            was={form.was}
            error={connError}
            busy={connecting}
            onConnect={(c) => {
              if (save(c, form.was)) open(c)
            }}
            onSave={(c) => {
              if (save(c, form.was)) {
                setForm(null)
                side.current?.focus()
              }
            }}
            onDelete={form.was ? () => remove(form.conn) : undefined}
            onCancel={() => {
              setForm(null)
              setConnError('')
              side.current?.focus()
            }}
            onFocus={() => setPart('form')}
          />
        )}
      </div>
      </div>
      <Hints items={hints} />
    </div>
  )
}

type FormProps = {
  initial: S.SqlConnection
  was?: string
  error: string
  busy: boolean
  onConnect(c: S.SqlConnection): void
  onSave(c: S.SqlConnection): void
  onDelete?: () => void
  onCancel(): void
  onFocus(): void
}

function ConnectionForm({ initial, was, error, busy, onConnect, onSave, onDelete, onCancel, onFocus }: FormProps) {
  const [c, setC] = useState<S.SqlConnection>(initial)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const set = (patch: Partial<S.SqlConnection>) => setC((x) => ({ ...x, ...patch }))
  const setEngine = (engine: S.SqlEngine) =>
    setC((x) => ({
      ...x,
      engine,
      port: !x.port || x.port === sql.defaultPorts[x.engine] ? sql.defaultPorts[engine] || undefined : x.port,
    }))
  const cleaned = (): S.SqlConnection => {
    const out: S.SqlConnection = { name: c.name.trim(), engine: c.engine }
    if (c.engine === 'sqlite') out.file = c.file?.trim()
    else {
      out.host = c.host?.trim() || undefined
      out.port = Number(c.port) || undefined
      out.user = c.user?.trim() || undefined
      out.password = c.password || undefined
      out.database = c.database?.trim() || undefined
      if (c.ssl) out.ssl = true
      if (c.engine === 'mssql' && c.trustCert === false) out.trustCert = false
    }
    return out
  }
  const field = (label: string, input: React.ReactNode, flex = 1) => (
    <div className="field" style={{ flex }}>
      <label>{label}</label>
      {input}
    </div>
  )
  const text = (key: 'host' | 'user' | 'password' | 'database' | 'file', placeholder = '', type = 'text') => (
    <input
      className="text-input"
      type={type}
      value={c[key] ?? ''}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => set({ [key]: e.target.value })}
    />
  )
  const ready = c.engine === 'sqlite' ? Boolean(c.file?.trim()) : true
  return (
    <div
      className="sql-form connect"
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        } else if (e.key === 'Enter' && !busy && ready && e.target instanceof HTMLInputElement) {
          e.preventDefault()
          onConnect(cleaned())
        }
      }}
    >
      <div className="sql-form-inner">
        <h2>{was ? `Edit ${was}` : 'New connection'}</h2>
        <div className="row-fields">
          {field(
            'Name (to save it)',
            <input ref={first} className="text-input" value={c.name} spellCheck={false} autoComplete="off" onChange={(e) => set({ name: e.target.value })} />,
            2,
          )}
          {field(
            'Database type',
            <select className="text-input" value={c.engine} onChange={(e) => setEngine(e.target.value as S.SqlEngine)}>
              {engines.map((e) => (
                <option key={e} value={e}>
                  {sql.engineNames[e]}
                </option>
              ))}
            </select>,
            2,
          )}
        </div>
        {c.engine === 'sqlite' ? (
          <div className="row-fields">{field('File (on this computer: a path, ~/…, or :memory:)', text('file', '~/data/app.db'))}</div>
        ) : (
          <>
            <div className="row-fields">
              {field('Host', text('host', 'localhost'), 3)}
              {field(
                'Port',
                <input
                  className="text-input"
                  value={c.port ?? ''}
                  inputMode="numeric"
                  placeholder={String(sql.defaultPorts[c.engine])}
                  onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || undefined })}
                />,
                1,
              )}
            </div>
            <div className="row-fields">
              {field('User', text('user'))}
              {field('Password', text('password', '', 'password'))}
            </div>
            <div className="row-fields">{field('Database', text('database', c.engine === 'postgres' ? 'postgres' : ''))}</div>
            <div className="sql-checks">
              <label>
                <input type="checkbox" checked={Boolean(c.ssl)} onChange={(e) => set({ ssl: e.target.checked })} /> {c.engine === 'mssql' ? 'Encrypt' : 'SSL'}
              </label>
              {c.engine === 'mssql' && (
                <label>
                  <input type="checkbox" checked={c.trustCert !== false} onChange={(e) => set({ trustCert: e.target.checked })} /> Trust the server's certificate
                </label>
              )}
            </div>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <div className="sql-form-buttons">
          <Button variant="primary" isDisabled={busy || !ready} onPress={() => onConnect(cleaned())}>
            {busy ? 'Connecting…' : c.name.trim() ? 'Save and connect' : 'Connect'}
          </Button>
          <Button variant="secondary" isDisabled={busy || !c.name.trim()} onPress={() => onSave(cleaned())}>
            Save
          </Button>
          {onDelete && (
            <Button variant="danger" isDisabled={busy} onPress={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="tertiary" onPress={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="help">Connections, passwords included, are saved in settings.json. Queries run from this computer.</div>
      </div>
    </div>
  )
}
