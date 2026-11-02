import { Menu } from '@tauri-apps/api/menu'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { agentFor, type Entry } from '../lib/agent'
import { openFile } from '../lib/actions'
import { copyText, errorText } from '../lib/bridge'
import { iconFor } from '../lib/fileIcons'
import { choose, prompt, toast } from '../lib/dialogs'
import { languageFor, monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import { useParts } from '../lib/parts'
import { basename, dirname, isInside, join, pretty } from '../lib/paths'
import { keyLabel } from '../lib/commands'
import * as S from '../lib/store'
import Hints from './Hints'
import SideSplitter, { sideStyle, useSideWidth } from './SideSplitter'

const neverShow = new Set(['.git', '.DS_Store'])

type Node = { path: string; name: string; dir: boolean; link: boolean; depth: number }

type Props = { tab: S.ExplorerTab; active: boolean }
type Move = { from: string; to: string }
type Clip = { op: 'copy' | 'cut'; path: string; project: string }

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

function FileIcon({ n, open, root }: { n: { name: string; path: string; dir: boolean }; open: boolean; root?: boolean }) {
  const src = iconFor(n.name, n.path, n.dir, open, root)
  return src ? <img className="ficon" src={src} alt="" draggable={false} /> : <span className="ficon" />
}

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
  const reveal = tab.reveal
  const [children, setChildren] = useState<Map<string, Entry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root]))
  const [selected, setSelected] = useState<string>(root)
  const [error, setError] = useState('')
  const tree = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const previewRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [previewNote, setPreviewNote] = useState('')
  const treeWidth = useSideWidth('explorer')
  const [moving, setMoving] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ from: string; over: string | null } | null>(null)
  const clipped = useClip()
  const cutPath = clipped?.op === 'cut' && clipped.project === project ? clipped.path : null
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
    const dirs = [root]
    if (reveal && isInside(reveal, root) && reveal !== root) {
      for (let d = dirname(reveal); d !== root && isInside(d, root); d = dirname(d)) dirs.push(d)
    }
    setExpanded((s) => new Set([...s, ...dirs]))
    Promise.all(dirs.map(load)).then(() => {
      if (reveal && isInside(reveal, root)) setSelected(reveal)
    })
  }, [root, reveal, load])

  const { part, setPart, list: parts, nav } = useParts('tree')
  parts.current = [
    { name: 'tree', focus: () => tree.current?.focus() },
    ...(previewNote ? [] : [{ name: 'preview', focus: () => previewRef.current?.focus() }]),
  ]
  useEffect(() => register(tab.id, { focus: () => tree.current?.focus(), ...nav }), [tab.id, nav])
  useEffect(() => {
    if (active) requestAnimationFrame(() => tree.current?.focus())
  }, [active])
  useEffect(() => {
    S.setPaneStatus(tab.id, { mode: 'normal', items: [pretty(root, '', home)] })
  }, [tab.id, root, home])
  useEffect(
    () => () =>
      S.set((s) => {
        const status = { ...s.status }
        delete status[tab.id]
        return { status }
      }),
    [tab.id],
  )

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
      cursorStyle: 'line-thin',
      matchBrackets: 'never',
      occurrencesHighlight: 'off',
    })
    previewRef.current = ed
    return () => {
      const m = ed.getModel()
      ed.dispose()
      m?.dispose()
    }
  }, [])

  useEffect(() => {
    const ed = previewRef.current
    if (!ed || !node) return
    let stale = false
    const timer = setTimeout(async () => {
      const show = (text: string, path: string | null) => {
        const prev = ed.getModel()
        ed.setModel(monaco.editor.createModel(text, languageFor(path, text.split('\n', 1)[0])))
        prev?.dispose()
      }
      if (node.dir) {
        const list = children.get(node.path) ?? (await agent.list(node.path).catch(() => [] as Entry[]))
        if (stale) return
        setPreviewNote('')
        show(list.filter((e) => !neverShow.has(e.name)).map((e) => e.name + (e.dir ? '/' : '')).join('\n'), null)
        return
      }
      try {
        const r = await agent.read(node.path, 512 * 1024)
        if (stale) return
        if (r.binary) {
          setPreviewNote(`Binary file, ${r.size.toLocaleString()} bytes`)
          show('', null)
        } else if (r.tooLarge) {
          setPreviewNote(`Too large to preview (${(r.size / 1048576).toFixed(1)} MB)`)
          show('', null)
        } else {
          setPreviewNote('')
          show(r.content, node.path)
        }
      } catch (err) {
        if (stale) return
        setPreviewNote(errorText(err))
        show('', null)
      }
    }, 60)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [node, children, agent])

  useEffect(() => {
    tree.current?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const toggle = async (n: Node, open?: boolean) => {
    const isOpen = expanded.has(n.path)
    const want = open ?? !isOpen
    if (want === isOpen) return
    if (want && !children.has(n.path)) await load(n.path)
    setExpanded((s) => {
      const next = new Set(s)
      if (want) next.add(n.path)
      else next.delete(n.path)
      return next
    })
  }

  const activate = (n: Node) => {
    if (n.dir) toggle(n)
    else openFile(n.path)
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
    if (isDir) setSelected(path)
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
    setSelected(path)
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
    if (n.path === root) return
    const at = nodes.indexOf(n)
    const v = await choose(`Delete ${n.name}?`, n.dir ? 'The folder and everything in it will be deleted.' : 'The file will be deleted.', [
      { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
      { label: 'Delete', value: 'delete', variant: 'danger' },
    ])
    if (v !== 'delete') return
    try {
      await agent.remove(n.path)
    } catch (err) {
      toast(errorText(err), 'error')
      return
    }
    if (cutPath && isInside(cutPath, n.path)) setClip(null)
    const next = nodes[at + 1] && !isInside(nodes[at + 1].path, n.path) ? nodes[at + 1] : nodes[at - 1]
    await load(dirname(n.path))
    loadChanges()
    if (next) setSelected(next.path)
  }

  const putOnClip = (op: Clip['op'], n: Node = node) => {
    if (n.path === root) return
    setClip({ op, path: n.path, project })
    toast(`${op === 'cut' ? 'Cut' : 'Copied'} ${n.name}, paste it into a folder`)
  }

  const paste = async (n: Node = node) => {
    if (!clipped || clipped.project !== project) return
    const dir = targetDir(n)
    const { op, path: from } = clipped
    if (op === 'cut') {
      if (dirname(from) === dir) return
      setClip(null)
      await moveInto(from, dir)
      return
    }
    try {
      const dirFrom = (await agent.stat(from)).dir
      let to = join(dir, basename(from))
      for (let i = 1; (await agent.stat(to)).exists; i++) to = join(dir, copyName(basename(from), dirFrom, i))
      await agent.copy(from, to)
      await reloadAround(to)
      loadChanges()
      toast(`Pasted ${basename(to)} into ${pretty(dir, '', home)}`)
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
    setSelected(n.path)
    const isRoot = n.path === root
    const canPaste = !!clipped && clipped.project === project
    const sep = { item: 'Separator' } as const
    const menu = await Menu.new({
      items: [
        ...(n.dir ? [] : [{ text: 'Open', action: () => openFile(n.path) }, sep]),
        { text: 'New File…', action: () => add(n) },
        { text: 'New Folder…', action: () => add(n, true) },
        sep,
        { text: 'Cut', accelerator: 'CmdOrCtrl+X', enabled: !isRoot, action: () => putOnClip('cut', n) },
        { text: 'Copy', accelerator: 'CmdOrCtrl+C', enabled: !isRoot, action: () => putOnClip('copy', n) },
        { text: 'Paste', accelerator: 'CmdOrCtrl+V', enabled: canPaste, action: () => paste(n) },
        sep,
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

  const moveInto = async (from: string, dir: string) => {
    const to = join(dir, basename(from))
    if (from === root || to === from) return
    if (isInside(dir, from)) {
      toast(`Can't move ${basename(from)} into itself`, 'error')
      return
    }
    if (await relocate(from, to)) toast(`Moved ${basename(from)} to ${pretty(dir, '', home)}`)
  }

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
  const moveDest = moving ? destination(node) : dragging?.over ?? null

  const startDrag = (e: React.MouseEvent, n: Node) => {
    if (e.button !== 0 || n.path === root) return
    const x = e.clientX
    const y = e.clientY
    let started = false
    let over: string | null = null
    let opener: ReturnType<typeof setTimeout> | undefined
    const place = (ev: MouseEvent) => {
      if (ghost.current) ghost.current.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`
    }
    const rowAt = (ev: MouseEvent) => (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('.explorer-tree .row[data-path]')
    const onMove = (ev: MouseEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - x) + Math.abs(ev.clientY - y) < 5) return
        started = true
        document.body.classList.add('dragging-file')
        setDragging({ from: n.path, over: null })
      }
      requestAnimationFrame(() => place(ev))
      const row = rowAt(ev)
      const target = row ? nodes.find((m) => m.path === row.dataset.path) : undefined
      const inTree = !row && (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.explorer-tree') === tree.current
      const dir = target ? destination(target) : inTree ? root : null
      if (dir !== over) {
        over = dir
        clearTimeout(opener)
        if (target?.dir && !expanded.has(target.path)) opener = setTimeout(() => toggle(target, true), 700)
        setDragging({ from: n.path, over: dir })
      }
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      clearTimeout(opener)
      document.body.classList.remove('dragging-file')
      setDragging(null)
      if (!started) return
      dragged.current = true
      setTimeout(() => (dragged.current = false))
      if (over) moveInto(n.path, over)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const dragged = useRef(false)
  const ghost = useRef<HTMLDivElement>(null)
  const draggedNode = dragging && nodes.find((m) => m.path === dragging.from)

  const refresh = async () => {
    await Promise.all([...expanded].map(load))
    loadChanges()
  }

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
    const go = (i: number) => setSelected(nodes[Math.max(0, Math.min(nodes.length - 1, i))].path)
    if (moving && (k === 'Escape' || k === 'm')) {
      setSelected(moving)
      setMoving(null)
    } else if (moving && k === 'Enter') {
      const from = moving
      setMoving(null)
      moveInto(from, destination(node))
    } else if (moving && !['j', 'k', 'g', 'G', 'h', 'l', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(k)) {
      // While moving, only the keys that pick a folder do anything.
    } else if (k === 'm') {
      if (node.path !== root) setMoving(node.path)
    } else if (k === 'j' || k === 'ArrowDown') go(index + 1)
    else if (k === 'k' || k === 'ArrowUp') go(index - 1)
    else if (k === 'g' || k === 'Home') go(0)
    else if (k === 'G' || k === 'End') go(nodes.length - 1)
    else if (k === 'PageDown') go(index + 15)
    else if (k === 'PageUp') go(index - 15)
    else if (k === 'Enter' || k === 'o') activate(node)
    else if (k === 'l' || k === 'ArrowRight') {
      if (node.dir) {
        if (expanded.has(node.path)) go(index + 1)
        else toggle(node, true)
      } else activate(node)
    } else if (k === 'h' || k === 'ArrowLeft') {
      if (node.dir && expanded.has(node.path) && node.path !== root) toggle(node, false)
      else if (node.path !== root) setSelected(dirname(node.path))
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

  return (
    <div className="explorer">
        <div className="explorer-body">
          <div
            className={`explorer-tree ${moveDest === root ? 'drop-root' : ''}`}
            ref={tree}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={() => setPart('tree')}
            onContextMenu={(e) => showMenu(e, nodes[0])}
            style={sideStyle(treeWidth)}
          >
            {nodes.map((n, i) => (
              <div
                key={n.path}
                data-path={n.path}
                className={`row ${i === index && !dragging ? 'selected' : ''} ${moveDest && moveDest !== root && isInside(n.path, moveDest) ? 'drop-zone' : ''} ${moveDest === n.path ? 'drop' : ''} ${(moving ?? dragging?.from) === n.path ? 'moving' : ''} ${cutPath && isInside(n.path, cutPath) ? 'cut' : ''}`}
                style={{ paddingLeft: `calc(0.6ch + ${n.depth * 16}px)` }}
                onContextMenu={(e) => showMenu(e, n)}
                onMouseDown={(e) => {
                  if (moving) return
                  setSelected(n.path)
                  startDrag(e, n)
                }}
                onClick={() => {
                  if (dragged.current) return
                  if (moving) setSelected(n.path)
                  else if (n.dir && n.path !== root) toggle(n)
                }}
                onDoubleClick={() => {
                  if (moving) {
                    const from = moving
                    setMoving(null)
                    moveInto(from, destination(n))
                  } else if (!n.dir) activate(n)
                }}
              >
                {n.dir ? <Chevron open={expanded.has(n.path)} /> : <span className="chev" />}
                <FileIcon n={n} open={expanded.has(n.path)} root={n.path === root} />
                <span className={`name ${n.dir ? 'dir' : changed.has(n.path) ? `st-${changed.get(n.path)}` : n.link ? 'link' : ''}`}>{n.name}</span>
                {n.link && <span className="dim"> →</span>}
                {moveDest === n.path && <span className="drop-label">{'  ← '}{basename(moving ?? dragging?.from ?? '')}</span>}
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
              <span className={draggedNode.dir ? 'dir' : ''}>{draggedNode.name}</span>
              {dragging.over && <span className="dim">{'  → '}{pretty(dragging.over, root, '') || basename(root) || '/'}</span>}
            </div>
          )}
          <SideSplitter side="explorer" target={tree} />
          <div className="explorer-preview" onFocus={() => setPart('preview')}>
            <div ref={previewHost} style={{ position: 'absolute', inset: 0, visibility: previewNote ? 'hidden' : undefined }} />
            {previewNote && <div className="note">{previewNote}</div>}
          </div>
        </div>
        <Hints
          items={
            moving
              ? [`moving ${basename(moving)}`, '↑/↓ pick a folder', 'l/h expand/collapse', 'Enter move here', 'Esc cancel']
              : part === 'preview'
                ? ['↑/↓ scroll', 'select and copy text', 'Enter in the tree opens the file']
                : ['j/k move', 'Enter open', 'l/h expand/collapse', 'a/A new file/folder', 'r rename', 'm move', 'x/c/p cut/copy/paste', `${keyLabel('Z')} undo`, 'd delete', 'y copy path', 'R refresh']
          }
        />
    </div>
  )
}
