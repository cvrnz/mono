import { useEffect, useMemo, useRef, useState } from 'react'
import { agent, type Match } from '../lib/agent'
import { focusActive, openFile, root as rootPath } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { fuzzy, highlight } from '../lib/fuzzy'
import { languageFor, monaco } from '../lib/monaco'
import { join, pretty } from '../lib/paths'
import * as S from '../lib/store'

type Kind = 'files' | 'text'
type Result = { path: string; line?: number; col?: number; text?: string; positions: number[] }

let fileCache: { root: string; at: number; files: string[]; truncated: boolean } | null = null

async function listFiles(root: string) {
  if (fileCache && fileCache.root === root && Date.now() - fileCache.at < 30000) return fileCache
  const r = await agent.files(root)
  fileCache = { root, at: Date.now(), files: r.files, truncated: r.truncated }
  return fileCache
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

export default function SearchModal({ kind: initialKind, initial }: { kind: Kind; initial: string }) {
  const root = rootPath()
  const hello = S.useStore((s) => (s.conn.state === 'connected' || s.conn.state === 'lost' ? s.conn.hello : null))
  const [kind, setKind] = useState<Kind>(initialKind)
  const [text, setText] = useState(initial)
  const [cursor, setCursor] = useState(0)
  const [files, setFiles] = useState<string[] | null>(null)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const previewRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)

  useEffect(() => {
    input.current?.focus()
  }, [kind])

  useEffect(() => {
    if (kind !== 'files' || files) return
    listFiles(root).then(
      (r) => {
        setFiles(r.files)
        setTruncated(r.truncated)
      },
      (err) => setError(errorText(err)),
    )
  }, [kind, files, root])

  useEffect(() => {
    if (kind !== 'text') return
    const q = text
    if (!q) {
      setMatches([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      agent.grep(root, q).then(
        (r) => {
          if (stale) return
          setMatches(r.matches)
          setTruncated(r.truncated)
          setError('')
        },
        (err) => !stale && setError(errorText(err)),
      )
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [kind, text, root])

  const results = useMemo((): Result[] => {
    if (kind === 'files') {
      if (!files) return []
      if (!text.trim()) return files.slice(0, 300).map((path) => ({ path, positions: [] }))
      const q = text.trim().replace(/\s+/g, '')
      const scored: { r: Result; score: number }[] = []
      for (const path of files) {
        const m = fuzzy(q, path, true)
        if (m) scored.push({ r: { path, positions: m.positions }, score: m.score })
      }
      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, 300).map((x) => x.r)
    }
    return (matches ?? []).map((m) => {
      const lower = m.text.toLowerCase()
      const q = /[A-Z]/.test(text) ? text : text.toLowerCase()
      const at = (/[A-Z]/.test(text) ? m.text : lower).indexOf(q)
      const positions = at >= 0 ? Array.from({ length: q.length }, (_, i) => at + i) : []
      return { path: m.path, line: m.line, col: m.col, text: m.text, positions }
    })
  }, [kind, files, matches, text])

  const index = Math.min(cursor, Math.max(0, results.length - 1))
  const selected = results[index]

  useEffect(() => {
    list.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useEffect(() => {
    const st = S.get().settings
    const ed = monaco.editor.create(previewHost.current!, {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: st.lineNumbers ? 'on' : 'off',
      lineDecorationsWidth: '2ch',
      folding: false,
      glyphMargin: false,
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      fontFamily: st.fontFamily,
      fontSize: st.fontSize,
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      guides: { indentation: false },
      stickyScroll: { enabled: false },
      matchBrackets: 'never',
      occurrencesHighlight: 'off',
    })
    previewRef.current = ed
    decorations.current = ed.createDecorationsCollection()
    return () => {
      const m = ed.getModel()
      ed.dispose()
      m?.dispose()
    }
  }, [])

  const previewPath = selected?.path
  const previewLine = selected?.line
  const [content, setContent] = useState<{ path: string; text: string } | null>(null)
  useEffect(() => {
    if (!previewPath) {
      setContent(null)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      agent.read(join(root, previewPath), 512 * 1024).then(
        (r) => !stale && setContent({ path: previewPath, text: r.binary ? '(binary file)' : r.tooLarge ? '(too large to preview)' : r.content }),
        () => !stale && setContent({ path: previewPath, text: '' }),
      )
    }, 50)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [previewPath, root])

  useEffect(() => {
    const ed = previewRef.current
    if (!ed) return
    const prev = ed.getModel()
    if (!content) {
      ed.setModel(null)
      prev?.dispose()
      return
    }
    if (!prev || (prev as unknown as { __path?: string }).__path !== content.path) {
      const model = monaco.editor.createModel(content.text, languageFor(content.path, content.text.split('\n', 1)[0]))
      ;(model as unknown as { __path?: string }).__path = content.path
      ed.setModel(model)
      prev?.dispose()
    }
  }, [content])

  useEffect(() => {
    const ed = previewRef.current
    if (!ed || !content || content.path !== previewPath) return
    if (previewLine) {
      ed.revealLineInCenter(previewLine)
      decorations.current?.set([{ range: new monaco.Range(previewLine, 1, previewLine, 1), options: { isWholeLine: true, className: 'search-hit-line' } }])
    } else {
      ed.setScrollTop(0)
      decorations.current?.clear()
    }
  }, [content, previewPath, previewLine])

  const close = () => {
    S.set({ search: null })
    focusActive()
  }

  const open = (r: Result | undefined) => {
    if (!r) return
    S.set({ search: null })
    openFile(join(root, r.path), r.line, r.col ? r.col - 1 : undefined)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey && !e.metaKey
    const step = (n: number) => results.length && setCursor(Math.max(0, Math.min(results.length - 1, index + n)))
    if (e.key === 'Escape') close()
    else if (e.key === 'Enter') open(selected)
    else if (e.key === 'Tab') {
      setKind((k) => (k === 'files' ? 'text' : 'files'))
      setCursor(0)
      setError('')
    } else if (e.key === 'ArrowDown' || (ctrl && (e.key === 'n' || e.key === 'j'))) step(1)
    else if (e.key === 'ArrowUp' || (ctrl && (e.key === 'p' || e.key === 'k'))) step(-1)
    else if (e.key === 'PageDown') step(15)
    else if (e.key === 'PageUp') step(-15)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const total = kind === 'files' ? (files?.length ?? 0) : results.length
  const loading = kind === 'files' ? files === null : matches === null && text !== ''
  return (
    <>
      <div className="floating-backdrop" onMouseDown={close} />
      <div className="floating" style={{ inset: '8% 8%' }}>
        <div className="floating-title">
          {kind === 'files' ? ' Search files   (Tab: search text)' : ' Search text   (Tab: search files)'}
          <span className="dim">{'   '}{pretty(root, '', hello?.home ?? '')}</span>
        </div>
        <div className="prompt">
          <span className="caret">{'>'}</span>
          <input
            ref={input}
            value={text}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
          />
          <span className="count">
            {loading ? '…' : kind === 'files' ? `${results.length >= 300 ? '300+' : results.length} / ${total}${truncated ? '+' : ''}` : `${results.length}${truncated ? '+' : ''}`}
          </span>
        </div>
        <div className="explorer-body">
          <div className="results" ref={list} style={{ width: '45%', flex: 'none', borderRight: '1px solid var(--separator)' }}>
            {results.map((r, i) => (
              <div
                key={`${r.path}:${r.line ?? ''}:${i}`}
                className={`row ${i === index ? 'selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setCursor(i)
                }}
                onDoubleClick={() => open(r)}
              >
                {kind === 'files' ? (
                  <Hit text={r.path} positions={r.positions} />
                ) : (
                  <>
                    <span className="dim">
                      {r.path}:{r.line}:{r.col}:{' '}
                    </span>
                    <Hit text={r.text ?? ''} positions={r.positions} />
                  </>
                )}
              </div>
            ))}
            {error && <div className="empty bad">{error}</div>}
            {!error && !loading && results.length === 0 && (
              <div className="empty">{kind === 'text' && !text ? 'Type to search inside files' : 'Nothing found'}</div>
            )}
          </div>
          <div className="explorer-preview">
            <div ref={previewHost} style={{ position: 'absolute', inset: 0 }} />
          </div>
        </div>
      </div>
    </>
  )
}
