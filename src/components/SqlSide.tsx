import { Button } from '@heroui/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { openQuery } from '../lib/actions'
import { copyText, errorText } from '../lib/bridge'
import { confirm, toast } from '../lib/dialogs'
import { register } from '../lib/panes'
import { updateSettings } from '../lib/settings'
import * as sql from '../lib/sql'
import * as S from '../lib/store'
import { useHints } from './Hints'
import Icon from './Icon'

type SqlIconName = 'folder' | 'database' | sql.ObjectKind | 'column' | 'key'

/** What the sidebar knows about a saved connection it has connected to, by connection name. */
type Live = { id: string; info?: sql.Info; connecting?: boolean; error?: string; dbs?: sql.Database[] }

type Row =
  | { kind: 'conn'; conn: S.SqlConnection; depth: number }
  | { kind: 'new'; depth: number }
  | { kind: 'folder'; conn: string; key: string; label: string; count: number; depth: number }
  | { kind: 'db'; conn: string; db: sql.Database; depth: number }
  | { kind: 'object'; conn: string; db: string; obj: sql.DbObject; depth: number }
  | { kind: 'column'; conn: string; column: sql.Column; depth: number }
  | { kind: 'note'; text: string; bad?: boolean; depth: number }

const engines = Object.keys(sql.engineNames) as S.SqlEngine[]
const none: S.SqlConnection[] = []
const sep = '\u0000'
const objKey = (db: string, o: sql.DbObject) => `${db}${sep}${o.schema}${sep}${o.name}`
const folders: [sql.ObjectKind, string][] = [
  ['table', 'Tables'],
  ['view', 'Views'],
  ['procedure', 'Stored procedures'],
  ['function', 'Functions'],
]
const hasColumns = (o: sql.DbObject) => o.kind === 'table' || o.kind === 'view'

/** The key a row is expanded under, each one inside its connection. */
function keyOf(r: Row | undefined): string | null {
  if (r?.kind === 'conn') return `c:${r.conn.name}`
  if (r?.kind === 'folder') return `${r.conn}${sep}${r.key}`
  if (r?.kind === 'db') return `${r.conn}${sep}d:${r.db.name}`
  if (r?.kind === 'object' && hasColumns(r.obj)) return `${r.conn}${sep}t:${objKey(r.db, r.obj)}`
  return null
}

const connOf = (r: Row | undefined): string | null => (!r || r.kind === 'new' || r.kind === 'note' ? null : r.kind === 'conn' ? r.conn.name : r.conn)

const iconPaths: Record<SqlIconName, React.ReactNode> = {
  folder: <path d="M1.5 4.5a1 1 0 0 1 1-1h3.4l1.6 1.6h6a1 1 0 0 1 1 1v6.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />,
  database: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  ),
  table: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12M2 9.8h12M6.5 6.5V13" />
    </>
  ),
  view: (
    <>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  procedure: <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 3 7 13" />,
  function: <path d="M11 2.5c-1.7 0-2.4.9-2.7 2.5L7 11c-.3 1.6-1 2.5-2.5 2.5M5.5 6.5h5" />,
  column: (
    <>
      <rect x="2.5" y="5" width="11" height="6" rx="1.2" />
      <path d="M6 8h4" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="8" r="2.6" />
      <path d="M8.1 8H14M12 8v2.4M14 8v2" />
    </>
  ),
}

function SqlIcon({ icon }: { icon: SqlIconName }) {
  return (
    <svg className={`sql-icon sql-icon-${icon}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {iconPaths[icon]}
    </svg>
  )
}

function Chevron({ open, hidden }: { open?: boolean; hidden?: boolean }) {
  return (
    <svg className={`chev ${open ? 'open' : ''}`} viewBox="0 0 16 16" aria-hidden style={hidden ? { visibility: 'hidden' } : undefined}>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function SqlSide({ id, active }: { id: string; active: boolean }) {
  const saved = S.useStore((s) => s.settings.sqlConnections) ?? none
  const [live, setLive] = useState<Record<string, Live>>({})
  const liveRef = useRef(live)
  useLayoutEffect(() => {
    liveRef.current = live
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [objects, setObjects] = useState<Map<string, sql.DbObject[] | string>>(new Map())
  const [columns, setColumns] = useState<Map<string, sql.Column[] | string>>(new Map())
  const [cursor, setCursor] = useState(0)
  const [form, setForm] = useState<{ conn: S.SqlConnection; was?: string } | null>(null)
  const [formError, setFormError] = useState('')
  const side = useRef<HTMLDivElement>(null)

  const patch = (name: string, p: Partial<Live>) => setLive((m) => ({ ...m, [name]: { ...(m[name] ?? { id: sql.newSqlId() }), ...p } }))

  useEffect(() => () => Object.values(liveRef.current).forEach((l) => void sql.disconnect(l.id)), [])

  const loadObjects = useCallback(async (conn: string, db: string, force = false) => {
    const l = liveRef.current[conn]
    const key = `${conn}${sep}${db}`
    if (!l?.info) return
    setObjects((m) => {
      if (m.has(key) && !force) return m
      const next = new Map(m)
      next.delete(key)
      return next
    })
    let got: sql.DbObject[] | string
    try {
      got = await sql.objects(l.id, db)
    } catch (err) {
      got = errorText(err)
    }
    setObjects((m) => new Map(m).set(key, got))
  }, [])

  const loadTree = useCallback(
    async (conn: string) => {
      const l = liveRef.current[conn]
      if (!l?.info) return
      try {
        const dbs = await sql.databases(l.id)
        patch(conn, { dbs, error: undefined })
        const cur = sql.currentDatabase(l.info)
        const open = [`${conn}${sep}dbs`]
        if (dbs.some((d) => d.name === cur && !d.system)) {
          open.push(`${conn}${sep}d:${cur}`, `${conn}${sep}f:${cur}${sep}table`)
          loadObjects(conn, cur)
        }
        setExpanded((s) => new Set([...s, ...open]))
      } catch (err) {
        patch(conn, { dbs: [], error: errorText(err) })
      }
    },
    [loadObjects],
  )

  /** Connects the sidebar to a saved connection, to show what's in it. */
  const connect = async (c: S.SqlConnection): Promise<boolean> => {
    const l = liveRef.current[c.name]
    if (l?.info) return true
    if (l?.connecting) return false
    const sid = l?.id ?? sql.newSqlId()
    patch(c.name, { id: sid, connecting: true, error: undefined })
    setExpanded((s) => new Set(s).add(`c:${c.name}`))
    try {
      const info = await sql.connect(sid, c)
      liveRef.current = { ...liveRef.current, [c.name]: { id: sid, info } }
      patch(c.name, { info, connecting: false })
      await loadTree(c.name)
      return true
    } catch (err) {
      patch(c.name, { connecting: false, error: errorText(err) })
      return false
    }
  }

  const disconnect = async (name: string) => {
    const l = liveRef.current[name]
    if (!l) return
    await sql.disconnect(l.id)
    setLive((m) => {
      const next = { ...m }
      delete next[name]
      return next
    })
    setExpanded((s) => new Set([...s].filter((k) => k !== `c:${name}` && !k.startsWith(name + sep))))
  }

  const save = (c: S.SqlConnection, was?: string): boolean => {
    const name = c.name.trim()
    const list = S.get().settings.sqlConnections ?? []
    if (!name) {
      toast('Give the connection a name', 'error')
      return false
    }
    if (name !== was && list.some((x) => x.name === name)) {
      toast(`There's already a connection called ${name}`, 'error')
      return false
    }
    const clean = { ...c, name }
    const i = list.findIndex((x) => x.name === (was ?? name))
    updateSettings({ sqlConnections: i >= 0 ? list.map((x, j) => (j === i ? clean : x)) : [...list, clean] })
    if (was && was !== name) void disconnect(was)
    return true
  }

  const remove = async (c: S.SqlConnection) => {
    if (!(await confirm(`Delete the connection ${c.name}?`, undefined, 'Delete', true))) return
    await disconnect(c.name)
    updateSettings({ sqlConnections: (S.get().settings.sqlConnections ?? []).filter((x) => x.name !== c.name) })
    setForm(null)
    side.current?.focus()
  }

  const closeForm = () => {
    setForm(null)
    setFormError('')
    requestAnimationFrame(() => side.current?.focus())
  }

  const loadColumns = async (conn: string, db: string, o: sql.DbObject) => {
    const l = liveRef.current[conn]
    const key = `${conn}${sep}${objKey(db, o)}`
    if (!l || columns.has(key)) return
    try {
      const list = await sql.columns(l.id, db, o.schema, o.name)
      setColumns((m) => new Map(m).set(key, list))
    } catch (err) {
      setColumns((m) => new Map(m).set(key, errorText(err)))
    }
  }

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    const tree = (conn: string, l: Live) => {
      const info = l.info!
      const kinds = info.engine === 'sqlite' ? folders.slice(0, 2) : folders
      const k = (x: string) => `${conn}${sep}${x}`
      const addObject = (db: string, obj: sql.DbObject, depth: number) => {
        out.push({ kind: 'object', conn, db, obj, depth })
        if (!hasColumns(obj) || !expanded.has(k(`t:${objKey(db, obj)}`))) return
        const cols = columns.get(k(objKey(db, obj)))
        if (cols === undefined) out.push({ kind: 'note', text: 'Loading…', depth: depth + 1 })
        else if (typeof cols === 'string') out.push({ kind: 'note', text: cols, bad: true, depth: depth + 1 })
        else for (const column of cols) out.push({ kind: 'column', conn, column, depth: depth + 1 })
      }
      const addDb = (db: sql.Database, depth: number) => {
        out.push({ kind: 'db', conn, db, depth })
        if (!expanded.has(k(`d:${db.name}`))) return
        const objs = objects.get(k(db.name))
        if (objs === undefined) return void out.push({ kind: 'note', text: 'Loading…', depth: depth + 1 })
        if (typeof objs === 'string') return void out.push({ kind: 'note', text: objs, bad: true, depth: depth + 1 })
        for (const [kind, label] of kinds) {
          const list = objs.filter((o) => o.kind === kind)
          const key = `f:${db.name}${sep}${kind}`
          out.push({ kind: 'folder', conn, key, label, count: list.length, depth: depth + 1 })
          if (expanded.has(k(key))) for (const o of list) addObject(db.name, o, depth + 2)
        }
      }
      if (!l.dbs) return void out.push({ kind: 'note', text: 'Loading…', depth: 1 })
      const system = l.dbs.filter((d) => d.system)
      out.push({ kind: 'folder', conn, key: 'dbs', label: 'Databases', count: l.dbs.length - system.length, depth: 1 })
      if (!expanded.has(k('dbs'))) return
      if (system.length) {
        out.push({ kind: 'folder', conn, key: 'sys', label: 'System databases', count: system.length, depth: 2 })
        if (expanded.has(k('sys'))) for (const d of system) addDb(d, 3)
      }
      for (const d of l.dbs) if (!d.system) addDb(d, 2)
    }
    for (const conn of saved) {
      out.push({ kind: 'conn', conn, depth: 0 })
      const l = live[conn.name]
      if (!l || !expanded.has(`c:${conn.name}`)) continue
      if (l.connecting) out.push({ kind: 'note', text: 'Connecting…', depth: 1 })
      else if (l.error && !l.info) out.push({ kind: 'note', text: l.error, bad: true, depth: 1 })
      else if (l.info) tree(conn.name, l)
    }
    out.push({ kind: 'new', depth: 0 })
    return out
  }, [saved, live, expanded, objects, columns])

  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  const row = rows[at] as Row | undefined

  const expand = async (r: Row | undefined, on?: boolean) => {
    const key = keyOf(r)
    if (!key || !r) return
    const opening = on ?? !expanded.has(key)
    if (r.kind === 'conn' && opening) {
      setExpanded((s) => new Set(s).add(key))
      await connect(r.conn)
      return
    }
    setExpanded((s) => {
      const next = new Set(s)
      if (opening) next.add(key)
      else next.delete(key)
      return next
    })
    if (!opening) return
    if (r.kind === 'db') loadObjects(r.conn, r.db.name)
    else if (r.kind === 'object') loadColumns(r.conn, r.db, r.obj)
  }

  const nameOf = (r: Row | undefined): string | null => {
    const info = r && 'conn' in r && typeof r.conn === 'string' ? live[r.conn]?.info : undefined
    if (!info || !r) return null
    if (r.kind === 'object') return sql.objectName(info, r.db, r.obj)
    if (r.kind === 'column') return sql.quoteName(info.engine, r.column.name)
    if (r.kind === 'db') return sql.quoteName(info.engine, r.db.name)
    return null
  }

  const newForm = () => {
    setFormError('')
    setForm({ conn: { name: '', engine: 'postgres', host: 'localhost', port: sql.defaultPorts.postgres } })
  }

  const choose = (r: Row | undefined, fresh = false) => {
    if (!r) return
    if (r.kind === 'new') return newForm()
    if (r.kind === 'conn') {
      void connect(r.conn)
      return openQuery(r.conn.name, undefined, fresh)
    }
    if (r.kind === 'folder' || r.kind === 'db') return void expand(r)
    if (r.kind === 'object') {
      if (hasColumns(r.obj)) openQuery(r.conn, { select: { db: r.db, obj: r.obj } }, fresh)
      else openQuery(r.conn, { insert: { db: r.db, obj: r.obj } })
    } else if (r.kind === 'column') openQuery(r.conn, { insert: nameOf(r)! })
  }

  const depthOf = (r: Row) => r.depth
  const parentIndex = (i: number): number => {
    const depth = rows[i] ? depthOf(rows[i]) : 0
    for (let j = i - 1; j >= 0; j--) if (depthOf(rows[j]) < depth) return j
    return i
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    const move = (n: number) => setCursor(Math.max(0, Math.min(rows.length - 1, n)))
    const conn = connOf(row)
    if (k === 'j' || k === 'ArrowDown') move(at + 1)
    else if (k === 'k' || k === 'ArrowUp') move(at - 1)
    else if (k === 'g' || k === 'Home') move(0)
    else if (k === 'G' || k === 'End') move(rows.length - 1)
    else if (k === 'Enter' || k === 'o') choose(row)
    else if (k === 'n' && conn) choose(rows.find((r) => r.kind === 'conn' && r.conn.name === conn), true)
    else if (k === 'l' || k === 'ArrowRight') {
      const key = keyOf(row)
      if (key && expanded.has(key)) move(at + 1)
      else void expand(row, true)
    } else if (k === 'h' || k === 'ArrowLeft') {
      const key = keyOf(row)
      if (key && expanded.has(key)) void expand(row, false)
      else move(parentIndex(at))
    } else if (k === 'a') newForm()
    else if (k === 'e' && row?.kind === 'conn') {
      setFormError('')
      setForm({ conn: row.conn, was: row.conn.name })
    } else if (k === 'd' && row?.kind === 'conn') void remove(row.conn)
    else if (k === 'x' && conn && live[conn]) {
      void disconnect(conn)
      move(rows.findIndex((r) => r.kind === 'conn' && r.conn.name === conn))
    } else if (k === 'i' && row && conn && nameOf(row)) openQuery(conn, { insert: nameOf(row)! })
    else if (k === 'y' && nameOf(row)) copyText(nameOf(row)!).then(() => toast(`Copied ${nameOf(row)}`))
    else if (k === 'u' && row?.kind === 'db') openQuery(row.conn, { database: row.db.name })
    else if (k === 'R' && conn && live[conn]?.info) {
      const db = row?.kind === 'db' ? row.db.name : row?.kind === 'object' ? row.db : row?.kind === 'folder' && row.key.startsWith('f:') ? row.key.slice(2).split(sep)[0] : null
      setColumns((m) => new Map([...m].filter(([key]) => !key.startsWith(conn + sep))))
      if (db) loadObjects(conn, db, true)
      else loadTree(conn)
    } else return
    e.preventDefault()
  }

  useEffect(() => {
    side.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [at, rows])

  useEffect(() => register(id, { focus: () => side.current?.focus() }), [id])

  const hints =
    row?.kind === 'conn'
      ? ['j/k move', 'Enter query', 'n new query', 'l/h expand/collapse', 'a add', 'e edit', 'd delete', ...(live[row.conn.name] ? ['x disconnect'] : [])]
      : row?.kind === 'new' || !row
        ? ['j/k move', 'Enter add a connection']
        : ['j/k move', 'Enter first 100 rows', 'n new query', 'l/h expand/collapse', 'i insert name', 'y copy name', 'u use database', 'R refresh', 'x disconnect']
  useHints(id, hints)

  const rowLabel = (r: Row) => {
    switch (r.kind) {
      case 'conn': {
        const l = live[r.conn.name]
        return (
          <>
            <Chevron open={Boolean(l) && expanded.has(`c:${r.conn.name}`)} />
            <SqlIcon icon="database" />
            <span className="name">{r.conn.name}</span>
            <span className="desc">{sql.engineNames[r.conn.engine]}</span>
            {l?.info && (
              <span className="run-actions">
                <span className="icon-btn" title="Disconnect (x)" onClick={(e) => (e.stopPropagation(), void disconnect(r.conn.name))}>
                  <Icon name="close" />
                </span>
              </span>
            )}
          </>
        )
      }
      case 'new':
        return (
          <>
            <Icon name="plus" className="sql-icon sql-add" />
            <span className="desc">New connection</span>
          </>
        )
      case 'folder':
        return (
          <>
            <Chevron open={expanded.has(keyOf(r)!)} />
            <SqlIcon icon="folder" />
            <span className="name">{r.label}</span>
            <span className="desc">{r.count}</span>
          </>
        )
      case 'db': {
        const info = live[r.conn]?.info
        return (
          <>
            <Chevron open={expanded.has(keyOf(r)!)} />
            <SqlIcon icon="database" />
            <span className="name">{r.db.name}</span>
            {info && r.db.name === sql.currentDatabase(info) && <span className="desc">default</span>}
          </>
        )
      }
      case 'object': {
        const info = live[r.conn]?.info
        const plain = !info || r.obj.schema === sql.defaultSchema(info, r.db)
        return (
          <>
            <Chevron open={expanded.has(keyOf(r) ?? '')} hidden={!hasColumns(r.obj)} />
            <SqlIcon icon={r.obj.kind} />
            <span className="name">
              {!plain && <span className="dim">{r.obj.schema}.</span>}
              {r.obj.name}
            </span>
          </>
        )
      }
      case 'column':
        return (
          <>
            <Chevron hidden />
            <SqlIcon icon={r.column.key ? 'key' : 'column'} />
            <span className={`name ${r.column.key ? 'sql-key' : ''}`}>{r.column.name}</span>
            <span className="desc">
              {r.column.type}
              {r.column.nullable ? '' : ', not null'}
            </span>
          </>
        )
      case 'note':
        return (
          <>
            <Chevron hidden />
            <span className={r.bad ? 'sql-bad' : 'desc'}>{r.text}</span>
          </>
        )
    }
  }

  return (
    <div className="sql-side" ref={side} tabIndex={0} onKeyDown={onKeyDown}>
      <div className="scm-title run-title">
        Connections
        <span className="icon-btn run-title-add" title="Add a connection (a)" onMouseDown={(e) => (e.preventDefault(), newForm())}>
          <Icon name="plus" />
        </span>
      </div>
      <div className="sql-rows">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`row sql-node run-row ${i === at ? 'selected' : ''}`}
            style={{ paddingLeft: `calc(var(--pad) + ${depthOf(r) * 16}px)` }}
            title={r.kind === 'note' ? r.text : r.kind === 'object' ? `${r.obj.kind} ${r.obj.schema}.${r.obj.name}` : r.kind === 'conn' ? sql.describe(r.conn) : undefined}
            onMouseDown={() => setCursor(i)}
            onClick={() => {
              if (keyOf(r)) void expand(r)
              else if (r.kind === 'new') newForm()
            }}
            onDoubleClick={() => r.kind !== 'folder' && r.kind !== 'db' && r.kind !== 'new' && choose(r)}
          >
            {rowLabel(r)}
          </div>
        ))}
      </div>
      {form && active && (
        <>
          <div className="floating-backdrop" onMouseDown={closeForm} />
          <div className="floating sql-dialog">
            <ConnectionForm
              key={form.was ?? 'new'}
              initial={form.conn}
              was={form.was}
              error={formError}
              busy={Boolean(live[form.conn.name]?.connecting)}
              onConnect={async (c) => {
                if (!save(c, form.was)) return
                setFormError('')
                if (await connect(c)) {
                  closeForm()
                  openQuery(c.name)
                } else setFormError(liveRef.current[c.name]?.error ?? "Couldn't connect")
              }}
              onSave={(c) => save(c, form.was) && closeForm()}
              onDelete={form.was ? () => remove(form.conn) : undefined}
              onCancel={closeForm}
            />
          </div>
        </>
      )}
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
}

function ConnectionForm({ initial, was, error, busy, onConnect, onSave, onDelete, onCancel }: FormProps) {
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
  const ready = Boolean(c.name.trim()) && (c.engine === 'sqlite' ? Boolean(c.file?.trim()) : true)
  return (
    <div
      className="sql-form connect"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
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
            'Name',
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
            {busy ? 'Connecting…' : 'Save and connect'}
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
