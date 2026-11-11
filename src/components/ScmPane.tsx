import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { agentFor, type Change, type Commit, type Repo } from '../lib/agent'
import { openCommit, openDiff, openFile, toggleGitLog, type OpenOptions } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { toast } from '../lib/dialogs'
import { register } from '../lib/panes'
import { basename, dirname, isInside, join, pretty } from '../lib/paths'
import { updateSettings } from '../lib/settings'
import * as S from '../lib/store'
import FileIcon from './FileIcon'
import { useHints } from './Hints'

type Busy = { repo: string; verb: string; frame: number } | { repo: string; text: string; cls: string }
type Item = { repo?: Repo; change?: Change; commit?: Commit; sync?: boolean }
type View = 'repos' | 'changes' | 'log'
type Row = { key: string; node: ReactNode; item?: Item; indent?: number; title?: string }

type Entry = { label: string; indent: number; repo?: Repo }
type TreeNode = { children: Map<string, TreeNode>; repo?: Repo }

function repoTree(repos: Repo[]): Entry[] {
  const top: TreeNode = { children: new Map() }
  for (const r of repos) {
    let node = top
    for (const part of r.name.split('/')) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() })
      node = node.children.get(part)!
    }
    node.repo = r
  }
  const out: Entry[] = []
  const walk = (node: TreeNode, indent: number) => {
    for (const [name, child] of [...node.children].sort(([a], [b]) => a.localeCompare(b))) {
      let label = name
      let at = child
      while (!at.repo && at.children.size === 1) {
        const [next, inner] = [...at.children][0]
        label += '/' + next
        at = inner
      }
      out.push(at.repo ? { label, indent, repo: at.repo } : { label: label + '/', indent })
      walk(at, indent + 1)
    }
  }
  walk(top, 0)
  return out
}

function ago(seconds: number): string {
  const s = Math.max(0, Date.now() / 1000 - seconds)
  const units: [number, string][] = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']]
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)}${u}`
  return 'now'
}

const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const lastFetch = new Map<string, number>()

export default function ScmPane({ id, active }: { id: string; active: boolean }) {
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [repo, setRepo] = useState<Repo | null>(null)
  const [files, setFiles] = useState<Change[]>([])
  const [log, setLog] = useState<Commit[] | null>(null)
  const [view, setView] = useState<View>('repos')
  const showLog = S.useStore((s) => s.settings.gitLog !== false)
  const panels = S.useStore((s) => s.settings.gitPanels)
  const [sel, setSel] = useState({ repos: 0, changes: 0, log: 0 })
  const [busy, setBusy] = useState<Busy | null>(null)
  const side = useRef<HTMLDivElement>(null)
  const repoRef = useRef<Repo | null>(null)
  repoRef.current = repo
  const project = S.useProjectId()
  const agent = useMemo(() => agentFor(project), [project])
  const hello = S.useProject((p) => (S.isConnected(p.conn) ? p.conn.hello : null))
  const rootPath = () => {
    const c = S.project(project)?.conn
    return c && S.isConnected(c) ? c.hello.root : '/'
  }
  const gitDepth = S.useStore((s) => s.settings.gitDepth)

  const refresh = useCallback(async (pick?: (list: Repo[]) => Repo | undefined, quiet = false) => {
    const root = rootPath()
    let list: Repo[]
    try {
      list = await agent.repos([root], S.get().settings.gitDepth)
    } catch (err) {
      if (!quiet) toast(errorText(err), 'error')
      return
    }
    setRepos(list)
    let current = repoRef.current ? list.find((r) => r.path === repoRef.current!.path) ?? null : null
    const picked = pick?.(list)
    if (picked) current = picked
    setRepo(current)
    if (current) {
      agent.changes(current.path).then(setFiles, () => setFiles([]))
      agent.log(current.path).then(setLog, () => setLog([]))
    }
    for (const r of list) {
      if (!r.sync || Date.now() - (lastFetch.get(project + r.path) ?? 0) < 60000) continue
      lastFetch.set(project + r.path, Date.now())
      agent.fetch(r.path, r.name).then(
        (fresh) => {
          setRepos((rs) => rs?.map((x) => (x.path === fresh.path ? fresh : x)) ?? rs)
          setRepo((cur) => (cur?.path === fresh.path ? fresh : cur))
        },
        () => {},
      )
    }
    return { list, current }
  }, [])

  useEffect(() => {
    const root = rootPath()
    refresh((list) => list.find((r) => isInside(root, r.path)) ?? (list.length === 1 ? list[0] : undefined)).then((res) => {
      if (res?.current) {
        setView('changes')
        setSel({ repos: repoTree(res.list).findIndex((e) => e.repo?.path === res.current!.path), changes: 0, log: 0 })
      }
    })
  }, [refresh])

  const shown = useRef({ root: hello?.root, gitDepth })
  useEffect(() => {
    if (shown.current.root === hello?.root && shown.current.gitDepth === gitDepth) return
    shown.current = { root: hello?.root, gitDepth }
    setRepos(null)
    refresh()
  }, [hello?.root, gitDepth, refresh])

  useEffect(() => {
    if (!active) return
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(undefined, true), 5000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [active, refresh])
  const wasActive = useRef(active)
  useEffect(() => {
    if (active && !wasActive.current) refresh()
    wasActive.current = active
  }, [active, refresh])

  const action = repo?.action ?? null
  const syncRow = useMemo((): Row | null => {
    if (!repo) return null
    const row = (node: ReactNode): Row => ({ key: 'sync', node, item: { sync: true } })
    if (busy && busy.repo === repo.path) {
      if ('verb' in busy) return row(<span className="dim">{`${spinner[busy.frame % spinner.length]} ${busy.verb}…`}</span>)
      return row(<span className={busy.cls}>{busy.text}</span>)
    }
    if (!action) return null
    return row(<span className={action.dim ? 'dim' : 'scm-action'}>{action.label}</span>)
  }, [repo, busy, action])

  const repoRows = useMemo((): Row[] => {
    if (!repos) return [{ key: 'wait', node: <span className="dim">Looking for repos…</span> }]
    if (repos.length === 0) {
      return [{ key: 'none', node: <span className="dim">{`No git repos in ${pretty(rootPath(), '', hello?.home ?? '')}`}</span> }]
    }
    return repoTree(repos).map((e) => {
      const r = e.repo
      if (!r) return { key: 'dir:' + e.label, indent: e.indent, node: <span className="dim name">{e.label}</span> }
      return {
        key: r.path,
        indent: e.indent,
        item: { repo: r },
        title: `${r.path}\n${r.branch}${r.arrows ? '  ' + r.arrows : ''}`,
        node: (
          <>
            <span className="name" style={repo?.path === r.path ? { color: 'var(--blue)', fontWeight: 'bold' } : undefined}>
              {e.label}
            </span>
            <span className="branch">
              <span className="dim">{r.branch}</span>
              {r.count > 0 && <span className="warnc">*</span>}
              {r.arrows && <span>{' ' + r.arrows}</span>}
            </span>
          </>
        ),
      }
    })
  }, [repos, repo, hello])

  const changeRows = useMemo((): Row[] => {
    if (!repo) return [{ key: 'pick', node: <span className="dim">Pick a repo above</span> }]
    const rows: Row[] = []
    if (syncRow) rows.push(syncRow)
    for (const c of files) {
      const dir = dirname(c.path)
      rows.push({
        key: 'c:' + c.path,
        item: { change: c },
        title: c.old ? `${c.old} → ${c.path}` : c.path,
        node: (
          <>
            <FileIcon n={{ name: basename(c.path), path: c.path, dir: false }} />
            <span className={`name ${c.status === 'D' ? 'gone' : ''}`}>{basename(c.path)}</span>
            {dir !== '.' && <span className="dim path">{dir}</span>}
            <span className={`status st-${c.status}`}>{c.status}</span>
          </>
        ),
      })
    }
    if (files.length === 0) rows.push({ key: 'clean', node: <span className="dim">No changes</span> })
    return rows
  }, [repo, files, syncRow])

  const logRows = useMemo((): Row[] => {
    if (!repo) return []
    if (!log) return [{ key: 'wait', node: <span className="dim">Loading…</span> }]
    if (log.length === 0) return [{ key: 'none', node: <span className="dim">No commits</span> }]
    return log.map((c) => ({
      key: c.hash,
      item: { commit: c },
      title: `${c.short}  ${c.author}  ${new Date(c.time * 1000).toLocaleString()}${c.refs ? `\n${c.refs}` : ''}\n\n${c.subject}`,
      node: (
        <>
          <span className="name">{c.subject}</span>
          <span className="dim when">{ago(c.time)}</span>
        </>
      ),
    }))
  }, [repo, log])

  const closed = (which: View) => (which === 'log' ? !showLog : Boolean(panels?.[which]?.closed))
  const listed: View[] = repo ? ['repos', 'changes', 'log'] : ['repos', 'changes']
  const open = listed.filter((w) => !closed(w))
  if (closed(view) && open.length) setView(open[0])

  const fold = (which: View) => {
    if (which === 'log') return toggleGitLog()
    const all = S.get().settings.gitPanels
    updateSettings({ gitPanels: { ...all, [which]: { ...all?.[which], closed: !closed(which) } } })
  }

  const setSizes = (sizes: Partial<Record<View, number>> | null, save: boolean) => {
    const all = S.get().settings.gitPanels
    const gitPanels = Object.fromEntries(listed.map((w) => [w, { closed: all?.[w]?.closed, size: sizes ? (sizes[w] ?? all?.[w]?.size) : undefined }]))
    if (save) updateSettings({ gitPanels })
    else S.set({ settings: { ...S.get().settings, gitPanels } })
  }

  const resize = (e: React.MouseEvent, above: View, below: View) => {
    if (e.button !== 0 || !side.current) return
    e.preventDefault()
    e.stopPropagation()
    const height = (w: View) => side.current!.querySelector(`.scm-${w}`)!.getBoundingClientRect().height
    const heights = Object.fromEntries(open.map((w) => [w, height(w)]))
    const least = side.current.querySelector('.scm-title')!.getBoundingClientRect().height * 2
    const both = heights[above] + heights[below]
    const y = e.clientY
    let sizes = heights
    const onMove = (ev: MouseEvent) => {
      const top = Math.min(both - least, Math.max(least, heights[above] + ev.clientY - y))
      sizes = { ...heights, [above]: Math.round(top), [below]: Math.round(both - top) }
      setSizes(sizes, false)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-rows')
      setSizes(sizes, true)
    }
    document.body.classList.add('resizing-rows')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Lists sized before another one was shown give it the average of theirs.
  const sized = open.map((w) => panels?.[w]?.size).filter((n): n is number => Boolean(n))
  const average = sized.length ? sized.reduce((a, b) => a + b, 0) / sized.length : 0
  const sizeStyle = (which: View) => (average && !closed(which) ? { flex: `${panels?.[which]?.size ?? average} 1 0`, maxHeight: 'none' } : undefined)

  const selectableIn = (rows: Row[]) => rows.map((r, i) => (r.item ? i : -1)).filter((i) => i >= 0)
  const cursorIn = (rows: Row[], at: number) => {
    const ok = selectableIn(rows)
    return ok.includes(at) ? at : (ok[0] ?? -1)
  }
  const cursors = { repos: cursorIn(repoRows, sel.repos), changes: cursorIn(changeRows, sel.changes), log: cursorIn(logRows, sel.log) }
  const rows = view === 'repos' ? repoRows : view === 'changes' ? changeRows : logRows
  const selectable = selectableIn(rows)
  const cursor = cursors[view]
  const entry = cursor >= 0 ? rows[cursor].item : undefined

  useEffect(() => register(id, { focus: () => side.current?.focus() }), [id])

  const selectRepo = async (r: Repo) => {
    setRepo(r)
    setView('changes')
    setLog(null)
    agent.log(r.path).then(setLog, () => setLog([]))
    let list: Change[] = []
    try {
      list = await agent.changes(r.path)
    } catch (err) {
      toast(errorText(err), 'error')
    }
    setFiles(list)
    setSel((s) => ({ ...s, changes: r.action ? 1 : 0, log: 0 }))
  }

  const runSync = async () => {
    const target = repoRef.current
    if (!target?.action || (busy && 'verb' in busy)) return
    const a = target.action
    let frame = 0
    setBusy({ repo: target.path, verb: a.verb, frame })
    const timer = setInterval(() => setBusy({ repo: target.path, verb: a.verb, frame: ++frame }), 80)
    let err: string | null = null
    try {
      await agent.sync(target.path)
      lastFetch.set(project + target.path, Date.now())
    } catch (e) {
      err = errorText(e)
    }
    clearInterval(timer)
    const done: Busy = err
      ? { repo: target.path, text: `✕ ${a.verb.replace(/ing$/, '')} failed`, cls: 'bad' }
      : { repo: target.path, text: `✓ ${a.done}`, cls: 'ok' }
    setBusy(done)
    if (err) toast(err, 'error')
    await refresh()
    setTimeout(() => setBusy((b) => (b === done ? null : b)), err ? 4000 : 2500)
  }

  const choose = (item: Item | undefined, opts: OpenOptions = { preview: true }) => {
    if (!item) return
    if (item.repo) selectRepo(item.repo)
    else if (item.sync) runSync()
    else if (item.change && repo) openDiff(repo.path, item.change, opts)
    else if (item.commit && repo) openCommit(repo.path, item.commit, opts)
  }

  const openChangedFile = (item: Item | undefined) => {
    if (item?.change && repo && item.change.status !== 'D') openFile(join(repo.path, item.change.path))
  }

  const move = (step: number) => {
    if (selectable.length === 0) return
    const i = selectable.indexOf(cursor)
    const next = selectable[Math.min(selectable.length - 1, Math.max(0, i + step))]
    setSel((s) => ({ ...s, [view]: next }))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const key = e.key
    if (key === 'Tab') {
      if (open.length) setView((v) => open[(open.indexOf(v) + (e.shiftKey ? open.length - 1 : 1)) % open.length])
    } else if (key === 'j' || key === 'ArrowDown') move(1)
    else if (key === 'k' || key === 'ArrowUp') move(-1)
    else if (key === 'g' || key === 'Home') move(-1e9)
    else if (key === 'G' || key === 'End') move(1e9)
    else if (key === 'Enter') choose(entry)
    else if (key === ' ' || key === 'l' || key === 'ArrowRight') choose(entry, { preview: true, focus: false })
    else if (key === 'o') openChangedFile(entry)
    else if (key === 'R') refresh()
    else if (key === 'L') toggleGitLog()
    else return
    e.preventDefault()
  }

  const names: Record<View, string> = { repos: 'Repos', changes: 'Changes', log: 'Log' }
  const tab = open.length > 1 ? `Tab ${names[open[(open.indexOf(view) + 1) % open.length]]}` : ''
  const hints =
    view === 'repos'
      ? ['j/k move', 'Enter show its changes', tab, 'R refresh']
      : view === 'log'
        ? ['j/k move', 'Enter show commit', 'l peek', tab, 'L hide log', 'R refresh']
        : ['j/k move', entry?.sync ? 'Enter sync' : 'Enter diff', 'l peek', 'o open file', tab, `L ${showLog ? 'hide' : 'show'} log`, 'R refresh']
  useHints(id, hints.filter(Boolean))

  useEffect(() => {
    side.current?.querySelectorAll('.row.selected').forEach((r) => r.scrollIntoView({ block: 'nearest' }))
  }, [cursors.repos, cursors.changes, cursors.log])

  const list = (which: View, title: string, items: Row[], extra?: ReactNode) => {
    const collapsed = closed(which)
    const above = collapsed ? undefined : open[open.indexOf(which) - 1]
    return (
      <div className={`scm-list scm-${which} ${view === which ? 'on' : ''} ${collapsed ? 'collapsed' : ''}`} style={sizeStyle(which)}>
        {above && <div className="scm-splitter" title="Drag to resize, double-click for the default sizes" onMouseDown={(e) => resize(e, above, which)} onDoubleClick={() => setSizes(null, true)} />}
        <div className="scm-title" onMouseDown={() => !collapsed && setView(which)}>
          <span
            className="scm-toggle"
            title={`${collapsed ? 'Show' : 'Hide'} ${names[which].toLowerCase()}${which === 'log' ? ' (L)' : ''}`}
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              fold(which)
            }}
          >
            <svg className={`chev ${collapsed ? '' : 'open'}`} viewBox="0 0 16 16" aria-hidden>
              <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {title}
          </span>
          {extra}
        </div>
        {!collapsed && <div className="scm-rows">
          {items.map((r, i) => {
            const c = r.item?.change
            return (
              <div
                key={r.key}
                title={r.title}
                className={`row ${i === cursors[which] ? 'selected' : ''}`}
                style={r.indent ? { paddingLeft: `calc(1ch + ${r.indent * 12}px)` } : undefined}
                onMouseDown={() => {
                  setView(which)
                  if (r.item) setSel((s) => ({ ...s, [which]: i }))
                }}
                onClick={() => r.item && choose(r.item, { preview: true, focus: false })}
                onDoubleClick={() => (c || r.item?.commit) && choose(r.item, {})}
              >
                {r.node}
              </div>
            )
          })}
        </div>}
      </div>
    )
  }

  return (
    <div className="scm">
      <div className="scm-side" ref={side} tabIndex={0} onKeyDown={onKeyDown}>
        {list('repos', 'Repositories', repoRows)}
        {list('changes', 'Changes', changeRows, repo && <span className="scm-repo">{'  ' + repo.name}</span>)}
        {repo && list('log', 'Log', logRows)}
      </div>
    </div>
  )
}
