import { Button } from '@heroui/react'
import type { CSSProperties, ReactNode } from 'react'
import * as A from '../lib/actions'
import { disconnect, newProject, reconnect } from '../lib/connection'
import { keyLabel } from '../lib/commands'
import { basename } from '../lib/paths'
import * as S from '../lib/store'
import CommandPalette from './CommandPalette'
import ConnectScreen from './ConnectScreen'
import EditorPane from './EditorPane'
import Explorer from './Explorer'
import ScmPane from './ScmPane'
import SqlPane from './SqlPane'
import SearchModal from './SearchModal'
import TerminalPane from './TerminalPane'
import Welcome from './Welcome'
import { noDrag, windowDrag, windowMenu } from '../lib/window'

export function tabLabel(tab: S.Tab): string {
  if (S.focusedPane(tab) !== tab.id) return 'Terminal'
  switch (tab.kind) {
    case 'scm':
      return 'Git'
    case 'welcome':
      return 'Welcome'
    case 'terminal':
      return 'Terminal'
    case 'file':
      return tab.path ? basename(tab.path) : 'Untitled'
    case 'explorer':
      return 'Explorer'
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
            title={`${projectDetails(p)}${i < 9 ? `\n${keyLabel(String(i + 1))}` : ''}`}
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

function TabBar() {
  const tabs = S.useStore((s) => s.tabs)
  const active = S.useStore((s) => s.active)
  return (
    <div className="tabbar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`tab ${noDrag} ${t.id === active ? 'active' : ''}`}
          title={t.kind === 'file' && t.path ? t.path : undefined}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              A.closeTab(t.id)
            } else if (e.button === 0) {
              e.preventDefault()
              A.activate(t.id)
            }
          }}
        >
          {tabLabel(t)}
          {t.kind === 'file' && t.dirty && <span className="dot"> ●</span>}
        </div>
      ))}
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
    case 'terminal':
      return <TerminalPane id={tab.id} tabId={tab.id} cwd={tab.cwd} active={active} centered={centered} />
    case 'scm':
      return <ScmPane id={tab.id} active={active} />
    case 'welcome':
      return <Welcome id={tab.id} active={active} />
    case 'explorer':
      return <Explorer tab={tab} active={active} />
    case 'sql':
      return <SqlPane tab={tab} active={active} />
  }
}

function ProjectPanes({ project, current }: { project: S.Project; current: boolean }) {
  const { tabs, active } = project
  const root = S.isConnected(project.conn) ? project.conn.hello.root : '/'
  return (
    <S.ProjectContext.Provider value={project.id}>
      {tabs.flatMap((tab) => {
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
  return (
    <div className="panes">
      {projects.map((p) => (
        <ProjectPanes key={p.id} project={p} current={p.id === current} />
      ))}
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
  const search = S.useStore((s) => s.search)
  const connected = S.useStore((s) => S.isConnected(s.conn))
  return (
    <div className="workspace">
      <div className="topbar" onMouseDown={windowDrag} onContextMenu={windowMenu}>
        <ProjectBar />
        <TabBar />
      </div>
      <div className="tabbar-spacer" />
      <Panes />
      {connected && <StatusBar />}
      <LostBanner />
      {connected && palette && <CommandPalette mode={palette.mode} initial={palette.text ?? ''} />}
      {connected && search && <SearchModal kind={search.kind} initial={search.text} />}
    </div>
  )
}
