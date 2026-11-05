import { Menu } from '@tauri-apps/api/menu'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { agentFor, dropFiles, onAgent, type Entry } from '../lib/agent'
import { explorerRefreshers, openFile, type OpenOptions } from '../lib/actions'
import { copyText, errorText, invoke } from '../lib/bridge'
import { choose, prompt, toast } from '../lib/dialogs'
import { register } from '../lib/panes'
import { basename, dirname, isInside, join, pretty } from '../lib/paths'
import { keyLabel } from '../lib/commands'
import * as S from '../lib/store'
import FileIcon from './FileIcon'
import { useHints } from './Hints'

const neverShow = new Set(['.git', '.DS_Store'])

type Node = { path: string; name: string; dir: boolean; link: boolean; depth: number }

type Props = { tab: S.ExplorerTab; active: boolean }
type Move = { from: string; to: string }
type Clip = { op: 'copy' | 'cut'; paths: string[]; project: string }
type Drag = { from: string; paths: string[]; over: string | null }

let clip: Clip | null = null
const clipListeners = new Set<() => void>()
const setClip = (c: Clip | null) => {
  clip = c
  clipListeners.forEach((f) => f())
}
const useClip = () =>
  useSyncExternalStore(
    (f) => {
      clipListeners.add(f)
      return () => clipListeners.delete(f)
    },
    () => clip,
  )

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chev ${open ? 'open' : ''}`} viewBox="0 0 16 16" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`

function copyName(name: string, dir: boolean, n: number): string {
  const dot = dir ? -1 : name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  return `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
}

export default function Explorer(props: Props) {
  const hello = S.useProject((p) => (S.isConnected(p.conn) ? p.conn.hello : null))
  if (!hello) return null
  return <Tree key={hello.root} {...props} root={hello.root} home={hello.home} />
}

function Tree({ tab, active, root, home }: Props & { root: string; home: string }) {
  const project = S.useProjectId()
  const agent = useMemo(() => agentFor(project), [project])
  const activePath = S.useProject((p) => {
    const t = p.tabs.find((x) => x.id === p.active)
    return t?.kind === 'file' ? t.path : t?.kind === 'diff' ? join(t.repo, t.change.path) : null
  })
  const reveal = active ? activePath : null
  const [children, setChildren] = useState<Map<string, Entry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root]))
  const [selected, setSelected] = useState<string>(root)
  // Rows picked with ⌘/Shift-click; empty means just the selected row.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const anchor = useRef(root)
  const select = useCallback((path: string) => {
    setSelected(path)
    setPicked(new Set())
    anchor.current = path
  }, [])
  const [error, setError] = useState('')
  const tree = useRef<HTMLDivElement>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Drag | null>(null)
  const [outside, setOutside] = useState<{ over: string | null; count: number } | null>(null)
  const clipped = useClip()
  const cutPaths = clipped?.op === 'cut' && clipped.project === project ? clipped.paths : []
  const isCut = (path: string) => cutPaths.some((c) => isInside(path, c))
  S.useStore((s) => s.previewTheme ?? s.settings.theme)

  const load = useCallback(async (dir: string): Promise<Entry[]> => {
    try {
      const list = (await agent.list(dir)).filter((e) => !neverShow.has(e.name))
      setChildren((m) => new Map(m).set(dir, list))
      return list
    } catch (err) {
      setError(errorText(err))
      return []
    }
  }, [agent])

  const [changed, setChanged] = useState<Map<string, string>>(new Map())
  const loadChanges = useCallback(async () => {
    const repos = await agent.repos([root]).catch(() => [])
    const lists = await Promise.all(
      repos.map((r) => agent.changes(r.path).then((l) => l.map((c) => [join(r.path, c.path), c.status] as const), () => [])),
    )
    setChanged(new Map(lists.flat()))
  }, [agent, root])
  const changedDirs = useMemo(() => {
    const dirs = new Set<string>()
    for (const p of changed.keys()) {
      for (let d = dirname(p); isInside(d, root) && !dirs.has(d); d = dirname(d)) {
        dirs.add(d)
        if (d === root) break
      }
    }
    return dirs
  }, [changed, root])
  useEffect(() => {
    if (!active) return
    loadChanges()
    const timer = setInterval(() => document.visibilityState === 'visible' && loadChanges(), 5000)
    return () => clearInterval(timer)
  }, [active, loadChanges])

  useEffect(() => {
    load(root)
  }, [root, load])

  useEffect(() => {
    if (!reveal || !isInside(reveal, root) || reveal === root) return
    const dirs: string[] = []
    for (let d = dirname(reveal); d !== root && isInside(d, root); d = dirname(d)) dirs.push(d)
    setExpanded((s) => (dirs.every((d) => s.has(d)) ? s : new Set([...s, root, ...dirs])))
    Promise.all(dirs.filter((d) => !children.has(d)).map(load)).then(() => select(reveal))
  }, [root, reveal, load, select])

  useEffect(() => register(tab.id, { focus: () => tree.current?.focus() }), [tab.id])

  const nodes = useMemo(() => {
    const out: Node[] = [{ path: root, name: pretty(root, '', home), dir: true, link: false, depth: 0 }]
    const walk = (dir: string, depth: number) => {
      for (const e of children.get(dir) ?? []) {
        const path = join(dir, e.name)
        out.push({ path, name: e.name, dir: e.dir, link: e.link, depth })
        if (e.dir && expanded.has(path)) walk(path, depth + 1)
      }
    }
    if (expanded.has(root)) walk(root, 1)
    return out
  }, [children, expanded, root, home])

  const index = Math.max(0, nodes.findIndex((n) => n.path === selected))
  const node = nodes[index]
  const isPicked = (path: string) => (picked.size ? picked.has(path) : path === node?.path)

  /** The rows an action applies to: everything picked when n is one of them, otherwise just n. */
  const chosen = (n: Node = node): Node[] => {
    const list = picked.size > 1 && picked.has(n.path) ? nodes.filter((m) => picked.has(m.path)) : [n]
    return list.filter((m) => m.path !== root && !list.some((o) => o !== m && isInside(m.path, o.path)))
  }

  const pickRange = (path: string) => {
    const a = nodes.findIndex((n) => n.path === (picked.size ? anchor.current : selected))
    const b = nodes.findIndex((n) => n.path === path)
    if (a < 0 || b < 0) return select(path)
    setSelected(path)
    setPicked(new Set(nodes.slice(Math.min(a, b), Math.max(a, b) + 1).map((n) => n.path)))
  }

  const togglePick = (path: string) => {
    const next = new Set(picked.size ? picked : [selected])
    if (next.has(path) && next.size > 1) next.delete(path)
    else next.add(path)
    setPicked(next)
    setSelected(path)
    anchor.current = path
  }

  useEffect(() => {
    tree.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const toggle = async (n: Node, open?: boolean) => {
    const isOpen = expanded.has(n.path)
    const want = open ?? !isOpen
    if (want === isOpen) return
    if (want) await load(n.path)
    setExpanded((s) => {
      const next = new Set(s)
      if (want) next.add(n.path)
      else next.delete(n.path)
      return next
    })
  }

  const activate = (n: Node, opts: OpenOptions = { preview: true }) => {
    if (n.dir) toggle(n)
    else openFile(n.path, undefined, undefined, opts)
  }

  const targetDir = (n: Node) => (n.dir ? n.path : dirname(n.path))

  const add = async (n: Node = node, folder = false) => {
    const dir = targetDir(n)
    const rel = dir === root ? '' : pretty(dir, root, '') + '/'
    const value = await prompt(folder ? 'New folder' : 'New file', rel, folder ? undefined : 'End with / to make a folder')
    if (!value?.trim()) return
    const isDir = folder || value.trim().endsWith('/')
    const path = join(root, value.trim())
    try {
      await agent.create(path, isDir)
    } catch (err) {
      toast(errorText(err), 'error')
      return
    }
    await reloadAround(path)
    loadChanges()
    if (isDir) select(path)
    else openFile(path)
  }

  const reloadAround = async (path: string) => {
    const dirs: string[] = []
    for (let d = dirname(path); isInside(d, root); d = dirname(d)) {
      dirs.push(d)
      if (d === root) break
    }
    await Promise.all(dirs.map(load))
    setExpanded((s) => new Set([...s, ...dirs]))
    select(path)
  }

  const rename = async (n: Node = node) => {
    if (n.path === root) return
    const rel = pretty(n.path, root, '')
    const start = rel.lastIndexOf('/') + 1
    const dot = n.dir ? -1 : rel.lastIndexOf('.')
    const value = await prompt('Rename', rel, 'A new name, or a new path to move it', [start, dot > start ? dot : rel.length])
    if (!value?.trim() || value.trim() === rel) return
    await relocate(n.path, join(root, value.trim()))
  }

  const remove = async (n: Node = node) => {
    const list = chosen(n)
    if (!list.length) return
    const one = list.length === 1 ? list[0] : null
    const names = list.slice(0, 5).map((m) => m.name).join(', ') + (list.length > 5 ? `, and ${list.length - 5} more` : '')
    const v = await choose(
      one ? `Delete ${one.name}?` : `Delete ${items(list.length)}?`,
      one ? (one.dir ? 'The folder and everything in it will be deleted.' : 'The file will be deleted.') : `${names} will be deleted, folders with everything in them.`,
      [
        { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
        { label: 'Delete', value: 'delete', variant: 'danger' },
      ],
    )
    if (v !== 'delete') return
    const gone = (path: string) => list.some((m) => isInside(path, m.path))
    const last = nodes.findLastIndex((m) => gone(m.path))
    const next = nodes.slice(last + 1).find((m) => !gone(m.path)) ?? nodes.slice(0, last).findLast((m) => !gone(m.path))
    for (const m of list) {
      try {
        await agent.remove(m.path)
      } catch (err) {
        toast(errorText(err), 'error')
        break
      }
    }
    if (cutPaths.some(gone)) setClip(null)
    await Promise.all([...new Set(list.map((m) => dirname(m.path)))].map(load))
    loadChanges()
    if (next) select(next.path)
  }

  const putOnClip = (op: Clip['op'], n: Node = node) => {
    const list = chosen(n)
    if (!list.length) return
    setClip({ op, paths: list.map((m) => m.path), project })
    toast(`${op === 'cut' ? 'Cut' : 'Copied'} ${list.length === 1 ? list[0].name : items(list.length)}, paste into a folder`)
  }

  const paste = async (n: Node = node) => {
    if (!clipped || clipped.project !== project) return
    const dir = targetDir(n)
    const { op, paths } = clipped
    if (op === 'cut') {
      setClip(null)
      await moveAll(paths.filter((from) => dirname(from) !== dir), dir)
      return
    }
    let last = ''
    try {
      for (const from of paths) {
        const dirFrom = (await agent.stat(from)).dir
        let to = join(dir, basename(from))
        for (let i = 1; (await agent.stat(to)).exists; i++) to = join(dir, copyName(basename(from), dirFrom, i))
        await agent.copy(from, to)
        last = to
      }
    } catch (err) {
      toast(errorText(err), 'error')
    }
    if (!last) return
    await reloadAround(last)
    loadChanges()
    toast(`Pasted ${paths.length === 1 ? basename(last) : items(paths.length)} into ${pretty(dir, '', home)}`)
  }

  const dropIn = async (paths: string[], dir: string) => {
    try {
      const made = await dropFiles(project, paths, dir)
      if (!made.length) return
      await reloadAround(made[0])
      setPicked(new Set(made))
      loadChanges()
      toast(`Copied ${made.length === 1 ? basename(made[0]) : items(made.length)} into ${pretty(dir, '', home)}`)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const inDocker = S.useProject((p) => p.conn.state !== 'idle' && p.conn.target.kind === 'docker')

  const download = async (n: Node = node) => {
    const list = chosen(n).length ? chosen(n) : [n]
    try {
      if (list.length === 1) {
        const to = await saveDialog({ defaultPath: list[0].name, title: `Download ${list[0].name}` })
        if (!to) return
        await invoke('download_file', { conn: project, path: list[0].path, to })
        toast(`Downloaded ${list[0].name}`)
        return
      }
      const dir = await openDialog({ directory: true, title: `Download ${items(list.length)} into` })
      if (typeof dir !== 'string') return
      for (const m of list) await invoke('download_file', { conn: project, path: m.path, to: join(dir, m.name) })
      toast(`Downloaded ${items(list.length)} into ${dir}`)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  const copyPath = (n: Node, relative: boolean) => {
    const text = relative ? pretty(n.path, root, '') || '.' : n.path
    copyText(text)
    toast(`Copied ${text}`)
  }

  const showMenu = async (e: React.MouseEvent, n: Node) => {
    e.preventDefault()
    e.stopPropagation()
    if (!(picked.size > 1 && picked.has(n.path))) select(n.path)
    const isRoot = n.path === root
    const canPaste = !!clipped && clipped.project === project
    const sep = { item: 'Separator' } as const
    const menu = await Menu.new({
      items: [
        ...(n.dir ? [] : [{ text: 'Open', action: () => activate(n, {}) }, sep]),
        { text: 'New File…', action: () => add(n) },
        { text: 'New Folder…', action: () => add(n, true) },
        sep,
        { text: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: !isRoot, action: () => putOnClip('cut', n) },
        { text: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: !isRoot, action: () => putOnClip('copy', n) },
        { text: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: canPaste, action: () => paste(n) },
        sep,
        ...(inDocker ? [{ text: chosen(n).length > 1 ? `Download ${items(chosen(n).length)}…` : 'Download…', action: () => download(n) }, sep] : []),
        { text: 'Copy Path', action: () => copyPath(n, false) },
        { text: 'Copy Relative Path', action: () => copyPath(n, true) },
        sep,
        { text: 'Rename…', enabled: !isRoot, action: () => rename(n) },
        { text: 'Delete', enabled: !isRoot, action: () => remove(n) },
      ],
    })
    await menu.popup()
  }

  const history = useRef<{ undo: Move[]; redo: Move[] }>({ undo: [], redo: [] })

  const relocate = async (from: string, to: string, record = true): Promise<boolean> => {
    try {
      await agent.rename(from, to)
    } catch (err) {
      toast(errorText(err), 'error')
      return false
    }
    if (record) history.current = { undo: [...history.current.undo, { from, to }], redo: [] }
    for (const t of S.get().tabs) {
      if (t.kind === 'file' && t.path && isInside(t.path, from)) S.updateTab(t.id, { path: to + t.path.slice(from.length) })
    }
    setExpanded((s) => new Set([...s].map((p) => (isInside(p, from) ? to + p.slice(from.length) : p))))
    await load(dirname(from))
    await reloadAround(to)
    loadChanges()
    return true
  }

  const moveAll = async (froms: string[], dir: string) => {
    let moved = 0
    for (const from of froms) {
      const to = join(dir, basename(from))
      if (from === root || to === from) continue
      if (isInside(dir, from)) {
        toast(`Can't move ${basename(from)} into itself`, 'error')
        continue
      }
      if (await relocate(from, to)) moved++
    }
    if (moved) toast(`Moved ${froms.length === 1 ? basename(froms[0]) : items(moved)} to ${pretty(dir, '', home)}`)
  }
  const moveInto = (from: string, dir: string) => moveAll([from], dir)

  const undo = async (redo = false) => {
    const { undo: done, redo: undone } = history.current
    const move = (redo ? undone : done).at(-1)
    if (!move) {
      toast(redo ? 'Nothing to redo' : 'Nothing to undo')
      return
    }
    const [from, to] = redo ? [move.from, move.to] : [move.to, move.from]
    if (!(await relocate(from, to, false))) return
    history.current = redo ? { undo: [...done, move], redo: undone.slice(0, -1) } : { undo: done.slice(0, -1), redo: [...undone, move] }
    toast(`${redo ? 'Redid' : 'Undid'} moving ${basename(move.from)}`)
  }

  const destination = (n: Node | undefined) => (n ? targetDir(n) : root)
  const moveDest = moving ? destination(node) : (dragging?.over ?? outside?.over ?? null)
  const dropWhat = moving ? basename(moving) : dragging ? (dragging.paths.length === 1 ? basename(dragging.from) : items(dragging.paths.length)) : items(outside?.count ?? 0)

  const dirAt = (x: number, y: number): string | null => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null
    const row = hit?.closest<HTMLElement>('.explorer-tree .row[data-path]')
    const target = row ? nodes.find((m) => m.path === row.dataset.path) : undefined
    if (target) return destination(target)
    return hit?.closest('.explorer-tree') === tree.current ? root : null
  }

  const startDrag = (e: React.MouseEvent, n: Node) => {
    if (e.button !== 0 || n.path === root) return
    const x = e.clientX
    const y = e.clientY
    const paths = chosen(n).map((m) => m.path)
    let started = false
    let cancelled = false
    let over: string | null = null
    let opener: ReturnType<typeof setTimeout> | undefined
    const place = (ev: MouseEvent) => {
      if (ghost.current) ghost.current.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`
    }
    const onMove = (ev: MouseEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - x) + Math.abs(ev.clientY - y) < 5) return
        started = true
        document.body.classList.add('dragging-file')
        setDragging({ from: n.path, paths, over: null })
      }
      requestAnimationFrame(() => place(ev))
      const dir = dirAt(ev.clientX, ev.clientY)
      if (dir !== over) {
        over = dir
        clearTimeout(opener)
        const target = nodes.find((m) => m.path === dir)
        if (target?.dir && !expanded.has(target.path)) opener = setTimeout(() => toggle(target, true), 700)
        setDragging({ from: n.path, paths, over: dir })
      }
    }
    const stop = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(opener)
      document.body.classList.remove('dragging-file')
      setDragging(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !started) return
      ev.preventDefault()
      ev.stopPropagation()
      cancelled = true
      stop()
    }
    const onUp = () => {
      window.removeEventListener('mouseup', onUp)
      stop()
      if (!started) return
      dragged.current = true
      setTimeout(() => (dragged.current = false))
      if (over && !cancelled) moveAll(paths, over)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey, true)
  }
  const dragged = useRef(false)
  const ghost = useRef<HTMLDivElement>(null)
  const draggedNode = dragging && nodes.find((m) => m.path === dragging.from)

  const refresh = async () => {
    await Promise.all([...expanded].map(load))
    loadChanges()
  }
  const latest = useRef({ refresh, dirAt, dropIn, children })
  latest.current = { refresh, dirAt, dropIn, children }

  useEffect(() => {
    const run = () => latest.current.refresh()
    explorerRefreshers.add(run)
    window.addEventListener('focus', run)
    return () => {
      explorerRefreshers.delete(run)
      window.removeEventListener('focus', run)
    }
  }, [])

  const watched = [...expanded].filter((d) => children.has(d)).sort().join('\n')
  useEffect(() => {
    agent.watch(watched ? watched.split('\n') : []).catch(() => {})
  }, [agent, watched])
  useEffect(() => () => void agent.watch([]).catch(() => {}), [agent])
  useEffect(
    () =>
      onAgent('fs.changed', (p: { dirs: string[] }, conn) => {
        if (conn !== project) return
        const shown = p.dirs.filter((d) => latest.current.children.has(d))
        if (!shown.length) return
        shown.forEach(load)
        loadChanges()
      }),
    [project, load, loadChanges],
  )

  useEffect(() => {
    let webview
    try {
      webview = getCurrentWebview()
    } catch {
      return
    }
    let off: (() => void) | undefined
    let live = true
    webview
      .onDragDropEvent(({ payload: p }) => {
        if (p.type === 'leave') return setOutside(null)
        const at = (q: { x: number; y: number }) => latest.current.dirAt(q.x / devicePixelRatio, q.y / devicePixelRatio)
        if (p.type === 'drop') {
          setOutside(null)
          const dir = at(p.position)
          if (dir && p.paths.length) latest.current.dropIn(p.paths, dir)
        } else setOutside((o) => ({ over: at(p.position), count: p.type === 'enter' ? p.paths.length : (o?.count ?? 0) }))
      })
      .then((f) => (live ? (off = f) : f()))
      .catch(() => {})
    return () => {
      live = false
      off?.()
    }
  }, [])

  const onKeyDown = async (e: React.KeyboardEvent) => {
    const mod = S.isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
    if (mod && !e.altKey && (e.code === 'KeyZ' || (!S.isMac() && e.code === 'KeyY'))) {
      e.preventDefault()
      e.stopPropagation()
      undo(e.shiftKey || e.code === 'KeyY')
      return
    }
    if (mod && !e.altKey && !e.shiftKey && !moving && ['KeyX', 'KeyC', 'KeyV'].includes(e.code)) {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'KeyV') paste()
      else putOnClip(e.code === 'KeyX' ? 'cut' : 'copy')
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key
    const clampTo = (i: number) => nodes[Math.max(0, Math.min(nodes.length - 1, i))].path
    const go = (i: number) => select(clampTo(i))
    if (!moving && e.shiftKey && (k === 'ArrowDown' || k === 'ArrowUp')) {
      pickRange(clampTo(index + (k === 'ArrowDown' ? 1 : -1)))
    } else if (!moving && k === 'Escape' && picked.size > 1) {
      select(node.path)
    } else if (moving && (k === 'Escape' || k === 'm')) {
      select(moving)
      setMoving(null)
    } else if (moving && k === 'Enter') {
      const from = moving
      setMoving(null)
      moveInto(from, destination(node))
    } else if (moving && !['j', 'k', 'g', 'G', 'h', 'l', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(k)) {
      // While moving, only the keys that pick a folder do anything.
    } else if (k === 'm') {
      if (node.path !== root) {
        setPicked(new Set())
        setMoving(node.path)
      }
    } else if (k === 'j' || k === 'ArrowDown') go(index + 1)
    else if (k === 'k' || k === 'ArrowUp') go(index - 1)
    else if (k === 'g' || k === 'Home') go(0)
    else if (k === 'G' || k === 'End') go(nodes.length - 1)
    else if (k === 'PageDown') go(index + 15)
    else if (k === 'PageUp') go(index - 15)
    else if ((k === 'Enter' || k === 'o') && picked.size > 1) {
      for (const m of chosen()) if (!m.dir) openFile(m.path)
    } else if (k === 'Enter' || k === 'o') activate(node)
    else if (k === ' ') activate(node, { preview: true, focus: false })
    else if (k === 'l' || k === 'ArrowRight') {
      if (node.dir) {
        if (expanded.has(node.path)) go(index + 1)
        else toggle(node, true)
      } else activate(node, { preview: true, focus: false })
    } else if (k === 'h' || k === 'ArrowLeft') {
      if (node.dir && expanded.has(node.path) && node.path !== root) toggle(node, false)
      else if (node.path !== root) select(dirname(node.path))
    } else if (k === 'a') add()
    else if (k === 'A') add(node, true)
    else if (k === 'x') putOnClip('cut')
    else if (k === 'c') putOnClip('copy')
    else if (k === 'p') paste()
    else if (k === 'r') rename()
    else if (k === 'd' || k === 'Delete') remove()
    else if (k === 'y') {
      copyText(node.path)
      toast(`Copied ${node.path}`)
    } else if (k === 'R') refresh()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  useHints(
    tab.id,
    moving
      ? [`moving ${basename(moving)}`, '↑/↓ pick a folder', 'l/h expand/collapse', 'Enter move here', 'Esc cancel']
      : picked.size > 1
        ? [`${items(picked.size)} picked`, 'Shift+↑/↓ extend', 'x/c/p cut/copy/paste', 'd delete', 'Enter open', 'Esc clear']
        : ['j/k move', 'Enter open', 'l peek', 'a/A new file/folder', 'r rename', 'm move', 'x/c/p cut/copy/paste', `${keyLabel('Mod+Z')} undo`, 'd delete', 'y copy path', 'R refresh'],
  )

  return (
    <div className="explorer">
        <div className="explorer-body">
          <div
            className={`explorer-tree ${moveDest === root ? 'drop-root' : ''}`}
            ref={tree}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => showMenu(e, nodes[0])}
          >
            {nodes.map((n, i) => (
              <div
                key={n.path}
                data-path={n.path}
                className={`row ${isPicked(n.path) && !dragging ? 'selected' : ''} ${picked.size > 1 && i === index ? 'cursor' : ''} ${moveDest && moveDest !== root && isInside(n.path, moveDest) ? 'drop-zone' : ''} ${moveDest === n.path ? 'drop' : ''} ${moving === n.path || dragging?.paths.includes(n.path) ? 'moving' : ''} ${isCut(n.path) ? 'cut' : ''}`}
                style={{ paddingLeft: `calc(0.6ch + ${n.depth * 16}px)` }}
                onContextMenu={(e) => showMenu(e, n)}
                onMouseDown={(e) => {
                  if (moving || e.button !== 0) return
                  if (e.shiftKey || (S.isMac() ? e.metaKey : e.ctrlKey)) {
                    e.preventDefault()
                    tree.current?.focus()
                    if (e.shiftKey) pickRange(n.path)
                    else togglePick(n.path)
                    return
                  }
                  if (picked.size > 1 && picked.has(n.path)) setSelected(n.path)
                  else select(n.path)
                  startDrag(e, n)
                }}
                onClick={(e) => {
                  if (dragged.current || e.shiftKey || e.metaKey || e.ctrlKey) return
                  if (picked.size > 1) select(n.path)
                  if (moving) setSelected(n.path)
                  else if (n.dir) {
                    if (n.path !== root) toggle(n)
                  } else activate(n, { preview: true, focus: false })
                }}
                onDoubleClick={() => {
                  if (moving) {
                    const from = moving
                    setMoving(null)
                    moveInto(from, destination(n))
                  } else if (!n.dir) activate(n, {})
                }}
              >
                {n.dir ? <Chevron open={expanded.has(n.path)} /> : <span className="chev" />}
                <FileIcon n={n} open={expanded.has(n.path)} />
                <span className={`name ${n.dir ? 'dir' : changed.has(n.path) ? `st-${changed.get(n.path)}` : n.link ? 'link' : ''}`}>{n.name}</span>
                {n.link && <span className="dim"> →</span>}
                {moveDest === n.path && <span className="drop-label">{'  ← '}{dropWhat}</span>}
                {n.dir
                  ? (changedDirs.has(n.path) || changed.has(n.path)) && <span className="st-M" title="Has uncommitted changes"> •</span>
                  : changed.has(n.path) && <span className={`st-${changed.get(n.path)}`}>  {changed.get(n.path)}</span>}
              </div>
            ))}
            {error && <div className="empty bad">{error}</div>}
          </div>
          {draggedNode && (
            <div className="drag-ghost" ref={ghost}>
              <FileIcon n={draggedNode} open={false} />
              <span className={draggedNode.dir ? 'dir' : ''}>{dragging.paths.length > 1 ? `${draggedNode.name} and ${items(dragging.paths.length - 1)} more` : draggedNode.name}</span>
              {dragging.over && <span className="dim">{'  → '}{pretty(dragging.over, root, '') || basename(root) || '/'}</span>}
            </div>
          )}
        </div>
    </div>
  )
}
