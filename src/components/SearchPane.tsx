import { useEffect, useMemo, useRef, useState } from 'react'
import { agentFor, type GrepOptions, type Match } from '../lib/agent'
import { focusActive, openFile, type OpenOptions } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { fuzzy, highlight } from '../lib/fuzzy'
import { register } from '../lib/panes'
import { basename, dirname, join } from '../lib/paths'
import * as S from '../lib/store'
import FileIcon from './FileIcon'
import { useHints } from './Hints'

type Kind = S.SearchKind
type Agent = ReturnType<typeof agentFor>
type Row =
  | { type: 'file'; path: string; count?: number; positions?: number[] }
  | { type: 'match'; m: Match; text: string; positions: number[] }

const fileCache = new Map<string, { at: number; files: string[]; truncated: boolean }>()
const MAX_FILES = 300

async function listFiles(agent: Agent, key: string, root: string) {
  const hit = fileCache.get(key)
  if (hit && Date.now() - hit.at < 30000) return hit
  const r = await agent.files(root)
  const entry = { at: Date.now(), files: r.files, truncated: r.truncated }
  fileCache.set(key, entry)
  return entry
}

function Hit({ text, positions }: { text: string; positions: number[] }) {
  return (
    <>
      {highlight(text, positions).map((r, i) =>
        r.hit ? (
          <span key={i} className="hit">
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  )
}

function matchRow(m: Match, query: string): Row {
  const start = m.col - 1
  const len = m.len ?? query.length
  const lead = Math.min(start, m.text.length - m.text.trimStart().length)
  const text = m.text.slice(lead)
  return { type: 'match', m, text, positions: Array.from({ length: len }, (_, i) => start - lead + i) }
}

const toggles: { key: keyof GrepOptions; label: string; title: string; code: string }[] = [
  { key: 'case', label: 'Aa', title: 'Match Case (Alt+C)', code: 'KeyC' },
  { key: 'word', label: 'ab', title: 'Match Whole Word (Alt+W)', code: 'KeyW' },
  { key: 'regex', label: '.*', title: 'Use Regular Expression (Alt+R)', code: 'KeyR' },
]

type Props = { tab: S.SearchTab; active: boolean }

export default function SearchPane(props: Props) {
  const hello = S.useProject((p) => (S.isConnected(p.conn) ? p.conn.hello : null))
  if (!hello) return null
  return <Search key={hello.root} {...props} root={hello.root} />
}

function Search({ tab, active, root }: Props & { root: string }) {
  const project = S.useProjectId()
  const agent = useMemo(() => agentFor(project), [project])
  const [kind, setKind] = useState<Kind>(tab.ask?.kind ?? 'text')
  const [text, setText] = useState(tab.ask?.text ?? '')
  const [opts, setOpts] = useState<GrepOptions>({})
  const [cursor, setCursor] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [files, setFiles] = useState<string[] | null>(null)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const reset = () => {
    setCursor(0)
    setError('')
  }

  const ask = tab.ask
  const asked = useRef(ask?.n)
  useEffect(() => {
    if (!ask || ask.n === asked.current) return
    asked.current = ask.n
    setKind(ask.kind)
    if (ask.text) setText(ask.text)
    reset()
    requestAnimationFrame(() => input.current?.select())
  }, [ask])

  useEffect(
    () =>
      register(tab.id, {
        focus: () => {
          input.current?.focus()
          input.current?.select()
        },
      }),
    [tab.id],
  )

  useEffect(() => {
    if (kind !== 'files' || !active) return
    let stale = false
    listFiles(agent, `${project}:${root}`, root).then(
      (r) => {
        if (stale) return
        setFiles(r.files)
        setTruncated(r.truncated)
      },
      (err) => !stale && setError(errorText(err)),
    )
    return () => {
      stale = true
    }
  }, [kind, active, agent, project, root])

  useEffect(() => {
    if (kind !== 'text') return
    const q = text
    if (!q) {
      setMatches([])
      setError('')
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      agent.grep(root, q, { case: Boolean(opts.case), word: opts.word, regex: opts.regex }).then(
        (r) => {
          if (stale) return
          setMatches(r.matches)
          setTruncated(r.truncated)
          setCollapsed(new Set())
          setError('')
        },
        (err) => {
          if (stale) return
          setMatches([])
          setError(errorText(err))
        },
      )
    }, 200)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [kind, text, opts, root, agent])

  const fileCount = useMemo(() => new Set((matches ?? []).map((m) => m.path)).size, [matches])

  const rows = useMemo((): Row[] => {
    if (kind === 'files') {
      if (!files) return []
      if (!text.trim()) return files.slice(0, MAX_FILES).map((path) => ({ type: 'file', path }))
      const q = text.trim().replace(/\s+/g, '')
      const scored: { r: Row; score: number }[] = []
      for (const path of files) {
        const m = fuzzy(q, path, true)
        if (m) scored.push({ r: { type: 'file', path, positions: m.positions }, score: m.score })
      }
      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, MAX_FILES).map((x) => x.r)
    }
    const out: Row[] = []
    const all = matches ?? []
    for (let i = 0; i < all.length; ) {
      const path = all[i].path
      let j = i
      while (j < all.length && all[j].path === path) j++
      out.push({ type: 'file', path, count: j - i })
      if (!collapsed.has(path)) for (const m of all.slice(i, j)) out.push(matchRow(m, text))
      i = j
    }
    return out
  }, [kind, files, matches, text, collapsed])

  const index = Math.min(cursor, Math.max(0, rows.length - 1))
  const selected = rows[index]

  useEffect(() => {
    list.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const toggleFile = (path: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const open = (r: Row | undefined, how: OpenOptions = { preview: true }) => {
    if (!r) return
    if (r.type === 'match') openFile(join(root, r.m.path), r.m.line, r.m.col - 1, { ...how, len: r.m.len ?? text.length })
    else if (kind === 'files') openFile(join(root, r.path), undefined, undefined, how)
    else toggleFile(r.path)
  }

  const toggle = (key: keyof GrepOptions) => {
    setOpts((o) => ({ ...o, [key]: !o[key] }))
    reset()
  }

  const switchKind = (k: Kind) => {
    if (k === kind) return
    setKind(k)
    reset()
    input.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey && !e.metaKey
    const step = (n: number) => rows.length && setCursor(Math.max(0, Math.min(rows.length - 1, index + n)))
    if (e.altKey && !e.metaKey && !e.ctrlKey) {
      const t = toggles.find((x) => x.code === e.code)
      if (!t || kind !== 'text') return
      toggle(t.key)
    } else if (e.metaKey) return
    else if (e.key === 'Escape') focusActive()
    else if (e.key === 'Enter') open(selected, e.shiftKey ? { preview: true, focus: false } : { preview: true })
    else if (e.key === 'Tab') switchKind(kind === 'files' ? 'text' : 'files')
    else if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) step(1)
    else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) step(-1)
    else if (e.key === 'PageDown') step(15)
    else if (e.key === 'PageUp') step(-15)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  useHints(tab.id, [
    '↑/↓ move',
    'Enter open',
    'Shift+Enter peek',
    `Tab ${kind === 'files' ? 'search text' : 'search files'}`,
    ...(kind === 'text' ? ['Alt+C/W/R case/word/regex'] : []),
    'Esc editor',
  ])

  const loading = kind === 'files' ? files === null : matches === null && text !== ''
  const summary =
    kind === 'files'
      ? files && `${rows.length >= MAX_FILES ? `${MAX_FILES}+` : rows.length} of ${files.length}${truncated ? '+' : ''} files`
      : text && matches && matches.length > 0
        ? `${matches.length}${truncated ? '+' : ''} result${matches.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`
        : ''

  return (
    <div className="search">
      <div className="search-head">
        <div className="search-kinds">
          {(['text', 'files'] as const).map((k) => (
            <span
              key={k}
              className={k === kind ? 'on' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                switchKind(k)
              }}
            >
              {k === 'files' ? 'Files' : 'Text'}
            </span>
          ))}
        </div>
        <div className="search-box">
          <input
            ref={input}
            value={text}
            spellCheck={false}
            autoComplete="off"
            placeholder={kind === 'files' ? 'Search file names' : 'Search'}
            onChange={(e) => {
              setText(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
          />
          {kind === 'text' &&
            toggles.map((t) => (
              <span
                key={t.key}
                role="button"
                title={t.title}
                className={`search-toggle ${opts[t.key] ? 'on' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  toggle(t.key)
                }}
              >
                {t.label}
              </span>
            ))}
        </div>
        {(summary || loading) && <div className="search-summary">{loading ? 'Searching…' : summary}</div>}
      </div>
      <div className="results search-results" ref={list}>
        {rows.map((r, i) => {
          const sel = i === index ? 'selected' : ''
          const mouse = (how: OpenOptions) => ({
            onMouseDown: (e: React.MouseEvent) => {
              e.preventDefault()
              setCursor(i)
              input.current?.focus()
            },
            onClick: () => open(r, { ...how, focus: false }),
            onDoubleClick: () => r.type !== 'file' || kind === 'files' ? open(r, {}) : undefined,
          })
          if (r.type === 'match') {
            return (
              <div key={`${r.m.path}:${r.m.line}:${i}`} className={`row match ${sel}`} title={`${r.m.path}:${r.m.line}`} {...mouse({ preview: true })}>
                <Hit text={r.text} positions={r.positions} />
              </div>
            )
          }
          const dir = dirname(r.path)
          return (
            <div key={`f:${r.path}`} className={`row file ${sel}`} title={r.path} {...mouse({ preview: true })}>
              {kind === 'text' && (
                <svg className={`chev ${collapsed.has(r.path) ? '' : 'open'}`} viewBox="0 0 16 16" aria-hidden>
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <FileIcon n={{ name: basename(r.path), path: r.path, dir: false }} />
              {r.positions ? (
                <span className="name">
                  <Hit text={r.path} positions={r.positions} />
                </span>
              ) : (
                <>
                  <span className="name">{basename(r.path)}</span>
                  {dir !== '.' && <span className="dim path">{dir}</span>}
                </>
              )}
              {r.count !== undefined && <span className="badge">{r.count}</span>}
            </div>
          )
        })}
        {error && <div className="empty bad">{error}</div>}
        {!error && !loading && rows.length === 0 && (
          <div className="empty">{kind === 'text' && !text ? 'Type to search inside files' : 'No results found'}</div>
        )}
      </div>
    </div>
  )
}
