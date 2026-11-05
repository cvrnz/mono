import { Button } from '@heroui/react'
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import * as A from '../lib/actions'
import { disconnect, newProject, reconnect } from '../lib/connection'
import { shortcut } from '../lib/commands'
import { basename } from '../lib/paths'
import * as S from '../lib/store'
import CommandPalette from './CommandPalette'
import RunPane from './RunPane'
import RunView from './RunView'
import ConnectScreen from './ConnectScreen'
import CommitPane from './CommitPane'
import DiffPane, { diffLabel } from './DiffPane'
import Hints from './Hints'
import EditorPane from './EditorPane'
import Explorer from './Explorer'
import ScmPane from './ScmPane'
import SqlPane from './SqlPane'
import SearchPane from './SearchPane'
import TerminalPane from './TerminalPane'
import SideSplitter, { sideStyle, useSideWidth } from './SideSplitter'
import TabIcon from './TabIcon'
import Welcome from './Welcome'
import { noDrag, windowDrag, windowMenu } from '../lib/window'

export function tabLabel(tab: S.Tab): string {
  const focused = S.focusedPane(tab)
  if (tab.kind === 'terminal' || focused !== tab.id) return S.get().procs[focused] || 'Terminal'
  switch (tab.kind) {
    case 'scm':
      return 'Git'
    case 'welcome':
      return 'Welcome'
    case 'file':
      return tab.path ? basename(tab.path) : 'Untitled'
    case 'diff':
      return diffLabel(tab)
    case 'commit':
      return tab.subject.length > 30 ? tab.subject.slice(0, 29) + '…' : tab.subject
    case 'explorer':
      return 'Explorer'
    case 'search':
      return 'Search'
    case 'run':
      return 'Run'
    case 'sql':
      return tab.conn ? `SQL: ${tab.conn}` : 'SQL'
  }
}

export function projectLabel(p: S.Project): string {
  const c = p.conn
  if (c.state === 'idle') return 'New project'
  const t = c.target
  if (t.kind === 'local') return basename(t.folder || (S.isConnected(c) ? c.hello.root : '')) || 'Folder'
  return t.container
}

function projectDetails(p: S.Project): string {
  const c = p.conn
  if (c.state === 'idle') return 'Not connected'
  const t = c.target
  const folder = S.isConnected(c) ? c.hello.root : t.folder
  const where = t.kind === 'local' ? `this computer · ${folder}` : `container ${t.container} · ${folder || '~'}`
  const state = c.state === 'connecting' ? ' (connecting)' : c.state === 'lost' ? ' (disconnected)' : ''
  return where + state
}

function ProjectBar() {
  const projects = S.useStore((s) => s.projects)
  const current = S.useStore((s) => s.project)
  return (
    <div className="projectbar">
      {projects.map((p, i) => {
        const dirty = p.tabs.some((t) => t.kind === 'file' && t.dirty)
        return (
          <div
            key={p.id}
            className={`project ${noDrag} ${p.id === current ? 'active' : ''} ${p.conn.state}`}
            title={`${projectDetails(p)}${i < 9 && shortcut(`Project${i + 1}`) ? `\n${shortcut(`Project${i + 1}`)}` : ''}`}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                A.switchToProject(i)
                disconnect()
              } else if (e.button === 0) {
                e.preventDefault()
                A.switchToProject(i)
              }
            }}
          >
            {i < 9 && <span className="num">{i + 1} </span>}
            {projectLabel(p)}
            {dirty && <span className="dot"> ●</span>}
          </div>
        )
      })}
      <div
        className={`project add ${noDrag}`}
        title="Open another container or folder"
        onMouseDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          newProject()
        }}
      >
        +
      </div>
    </div>
  )
}

function dragTab(e: React.MouseEvent, id: string) {
  const bar = (e.currentTarget as HTMLElement).parentElement
  if (!bar) return
  const x = e.clientX
  let started = false
  const onMove = (ev: MouseEvent) => {
    if (!started) {
      if (Math.abs(ev.clientX - x) < 5) return
      started = true
      document.body.classList.add('dragging-tab')
      S.set({ draggingTab: id })
    }
    const over = [...bar.querySelectorAll<HTMLElement>('.tab[data-id]')].find((el) => {
      const r = el.getBoundingClientRect()
      return ev.clientX >= r.left && ev.clientX < r.right
    })
    const target = over?.dataset.id
    if (!target || target === id) return
    S.set((s) => {
      const to = s.tabs.findIndex((t) => t.id === target)
      if (to < 0 || S.isFixed(s.tabs[to])) return {}
      const tabs = s.tabs.filter((t) => t.id !== id)
      tabs.splice(to, 0, s.tabs.find((t) => t.id === id)!)
      return { tabs }
    })
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.classList.remove('dragging-tab')
    if (started) S.set({ draggingTab: null })
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function tabTitle(t: S.Tab, icon: boolean): string | undefined {
  const preview = t.preview ? '\nPreview: opening another file replaces it. Double-click or edit to keep it.' : ''
  if (t.kind === 'file' && t.path) return t.path + preview
  if (t.kind === 'diff') return `${t.repo}/${t.change.path}${preview}`
  if (t.kind === 'commit') return `${t.hash.slice(0, 10)}  ${t.subject}${preview}`
  return icon ? tabLabel(t) : undefined
}

function TabBar() {
  const tabs = S.useStore((s) => s.tabs)
  const dragging = S.useStore((s) => s.draggingTab)
  const active = S.useStore((s) => s.active)
  const side = S.useStore((s) => S.sidebar(s))
  const icons = S.useStore((s) => Boolean(s.settings.tabIcons))
  S.useStore((s) => s.procs)
  return (
    <div className="tabbar">
      {tabs.map((t, i) => {
        const fixed = S.isFixed(t)
        const icon = icons && fixed
        const lastFixed = fixed && !(tabs[i + 1] && S.isFixed(tabs[i + 1]))
        return (
          <Fragment key={t.id}>
            <div
              data-id={fixed ? undefined : t.id}
              className={`tab ${noDrag} ${(fixed ? side === t.kind : t.id === active) ? 'active' : ''} ${icon ? 'icon' : ''} ${t.preview ? 'preview' : ''} ${t.id === dragging ? 'dragging' : ''}`}
              title={tabTitle(t, icon)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  A.closeTab(t.id)
                } else if (e.button === 0) {
                  e.preventDefault()
                  if (fixed) A.clickSidebarTab(t.kind as S.FixedKind)
                  else {
                    A.activate(t.id)
                    dragTab(e, t.id)
                  }
                }
              }}
              onDoubleClick={() => A.keepTab(t.id)}
            >
              {icon ? <TabIcon kind={t.kind as S.FixedKind} /> : tabLabel(t)}
              {t.kind === 'file' && t.dirty && <span className="dot"> ●</span>}
            </div>
            {lastFixed && <div className="tab-divider" />}
          </Fragment>
        )
      })}
    </div>
  )
}

const modeNames: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'VISUAL LINE',
  'visual-block': 'VISUAL BLOCK',
  replace: 'REPLACE',
  terminal: 'TERMINAL',
}

function StatusBar() {
  const tab = S.useStore((s) => s.tabs.find((t) => t.id === s.active))
  const status = S.useStore((s) => (tab ? s.status[S.focusedPane(tab)] : undefined))
  const conn = S.useStore((s) => s.conn)
  const mode = modeNames[status?.mode ?? 'normal'] ?? status?.mode?.toUpperCase() ?? 'NORMAL'
  const parts: ReactNode[] = []
  if (status?.errors) parts.push(<span className="error">✖ {status.errors}</span>)
  if (status?.warnings) parts.push(<span className="warn">▲ {status.warnings}</span>)
  for (const item of status?.items ?? []) if (item) parts.push(item)
  return (
    <div className="statusbar">
      <span className="left">
        {mode}
        {conn.state === 'lost' && <span className="lost">{'    '}Disconnected</span>}
      </span>
      <span className="right">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && '    '}
            {p}
          </span>
        ))}
      </span>
    </div>
  )
}

function LostBanner() {
  const conn = S.useStore((s) => s.conn)
  if (conn.state !== 'lost') return null
  return (
    <div className="lost-banner">
      <span>Lost the connection to the container.</span>
      <span className="why" title={conn.error}>
        {conn.error}
      </span>
      <Button size="sm" variant="primary" isDisabled={conn.reconnecting} onPress={() => reconnect()}>
        {conn.reconnecting ? 'Reconnecting…' : 'Reconnect'}
      </Button>
    </div>
  )
}

function paneStyle(index: number, count: number, dir: S.Splits['dir'] | undefined): CSSProperties {
  if (count === 1 || !dir) return { inset: 0 }
  const size = 100 / count
  if (dir === 'below') return { left: 0, right: 0, top: `${index * size}%`, height: `${size}%` }
  return { top: 0, bottom: 0, left: `${index * size}%`, width: `${size}%` }
}

function content(tab: S.Tab, active: boolean, centered: boolean): ReactNode {
  switch (tab.kind) {
    case 'file':
      return <EditorPane tab={tab} active={active} centered={centered} />
    case 'diff':
      return <DiffPane tab={tab} active={active} />
    case 'commit':
      return <CommitPane tab={tab} active={active} />
    case 'terminal':
      return <TerminalPane id={tab.id} tabId={tab.id} cwd={tab.cwd} active={active} centered={centered} />
    case 'welcome':
      return <Welcome id={tab.id} active={active} />
    case 'sql':
      return <SqlPane tab={tab} active={active} />
    default:
      return null
  }
}

function sideContent(tab: S.Tab, shown: boolean): ReactNode {
  switch (tab.kind) {
    case 'explorer':
      return <Explorer tab={tab} active={shown} />
    case 'scm':
      return <ScmPane id={tab.id} active={shown} />
    case 'search':
      return <SearchPane tab={tab} active={shown} />
    case 'run':
      return <RunPane tab={tab} active={shown} />
    default:
      return null
  }
}

function HintsBar() {
  const [inSide, setInSide] = useState(false)
  useEffect(() => {
    const onFocus = () => setInSide(A.sidebarFocused())
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  const items = S.useStore((s) => {
    const kind = S.sidebar(s)
    const side = kind ? s.tabs.find((t) => t.kind === kind) : undefined
    const sideHints = side && s.hints[side.id]
    const tabHints = s.active ? s.hints[s.active] : undefined
    return inSide ? (sideHints ?? tabHints) : (tabHints ?? sideHints)
  })
  return items ? <Hints items={items} /> : null
}

function Sidebar() {
  const projects = S.useStore((s) => s.projects)
  const current = S.useStore((s) => s.project)
  const kind = S.useStore((s) => S.sidebar(s))
  const connected = S.useStore((s) => S.isConnected(s.conn))
  const width = useSideWidth('sidebar')
  const ref = useRef<HTMLDivElement>(null)
  const open = Boolean(kind && connected)
  return (
    <>
      <div className={`sidebar ${open ? '' : 'hidden'}`} ref={ref} style={sideStyle(width)}>
        {projects.map((p) => (
          <S.ProjectContext.Provider key={p.id} value={p.id}>
            {p.tabs.filter(S.isFixed).map((tab) => {
              const shown = p.id === current && tab.kind === kind
              return (
                <div key={tab.id} className={`side-view ${shown ? '' : 'hidden'}`}>
                  {S.isConnected(p.conn) && sideContent(tab, shown)}
                </div>
              )
            })}
          </S.ProjectContext.Provider>
        ))}
      </div>
      {open && <SideSplitter side="sidebar" target={ref} />}
    </>
  )
}

function ProjectPanes({ project, current }: { project: S.Project; current: boolean }) {
  const { tabs, active } = project
  const root = S.isConnected(project.conn) ? project.conn.hello.root : '/'
  return (
    <S.ProjectContext.Provider value={project.id}>
      {tabs.filter((t) => !S.isFixed(t)).flatMap((tab) => {
        const ids = [tab.id, ...(tab.splits?.panes ?? [])]
        const shown = current && tab.id === active
        const focused = S.focusedPane(tab)
        return ids.map((id, i) => (
          <div
            key={id}
            className={`pane ${shown ? '' : 'hidden'} ${tab.splits ? 'split-' + tab.splits.dir : ''}`}
            style={paneStyle(i, ids.length, tab.splits?.dir)}
            onMouseDownCapture={() => A.focusPane(tab.id, id)}
            onFocusCapture={() => A.focusPane(tab.id, id)}
          >
            {id === tab.id ? (
              content(tab, shown && focused === id, ids.length === 1)
            ) : (
              <TerminalPane id={id} tabId={tab.id} cwd={root} active={shown && focused === id} centered={false} />
            )}
          </div>
        ))
      })}
    </S.ProjectContext.Provider>
  )
}

function Panes() {
  const projects = S.useStore((s) => s.projects)
  const current = S.useStore((s) => s.project)
  const connected = S.useStore((s) => S.isConnected(s.conn))
  const runView = S.useStore((s) => (s.runView && s.runs.some((r) => r.id === s.runView && r.project === s.project) ? s.runView : null))
  return (
    <div className="panes">
      {projects.map((p) => (
        <ProjectPanes key={p.id} project={p} current={p.id === current} />
      ))}
      {connected && runView && <RunView key={runView} id={runView} />}
      {!connected && (
        <div className="connect-layer">
          <ConnectScreen key={current} />
        </div>
      )}
    </div>
  )
}

export default function Workspace() {
  const palette = S.useStore((s) => s.palette)
  const connected = S.useStore((s) => S.isConnected(s.conn))
  return (
    <div className="workspace">
      <div className="topbar" onMouseDown={windowDrag} onContextMenu={windowMenu}>
        <ProjectBar />
        <TabBar />
      </div>
      <div className="tabbar-spacer" />
      <div className="main">
        <Sidebar />
        <Panes />
      </div>
      {connected && <HintsBar />}
      {connected && <StatusBar />}
      <LostBanner />
      {connected && palette && <CommandPalette mode={palette.mode} initial={palette.text ?? ''} />}
    </div>
  )
}
