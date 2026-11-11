import { connect, sameTarget } from './connection'
import { pane } from './panes'
import { dropOutputsBut, flushOutputs, restoreShell, shellKey } from './terminals'
import { updateSettings } from './settings'
import * as S from './store'

const pending = new Map<string, S.SavedProject>()
const cursors = new Map<string, { line: number; col: number }>()

function terminalPanes(t: { kind: string; id: string; splits?: S.Splits }): string[] {
  return [...(t.kind === 'terminal' ? [t.id] : []), ...(t.splits?.panes ?? [])]
}

function saveTab(t: S.Tab): S.SavedTab | null {
  const st = saveTabOnly(t)
  const panes = terminalPanes(t)
  if (!st || !panes.length) return st
  const cwds = S.get().cwds
  return { ...st, shells: panes.map((p) => ({ cwd: cwds[p], key: shellKey(p) })) }
}

function saveTabOnly(t: S.Tab): S.SavedTab | null {
  const splits = t.splits ? { dir: t.splits.dir, count: t.splits.panes.length } : undefined
  switch (t.kind) {
    case 'file': {
      if (!t.path) return null
      const pos = pane(t.id)?.editor?.getPosition()
      if (pos) cursors.set(t.id, { line: pos.lineNumber, col: pos.column - 1 })
      const c = cursors.get(t.id) ?? (t.line ? { line: t.line, col: t.col ?? 0 } : undefined)
      return { kind: 'file', path: t.path, ...c, preview: t.preview || undefined, splits }
    }
    case 'diff':
      return { kind: 'diff', repo: t.repo, change: t.change, preview: t.preview || undefined }
    case 'commit':
      return { kind: 'commit', repo: t.repo, hash: t.hash, subject: t.subject, preview: t.preview || undefined }
    case 'terminal':
      return { kind: 'terminal', cwd: t.cwd, splits }
    case 'sql':
      return { kind: 'sql', conn: t.conn, text: t.text, splits }
    default:
      return { kind: t.kind, splits }
  }
}

function snapshot(): S.SavedSession {
  const s = S.get()
  const projects: S.SavedProject[] = []
  let current = 0
  for (const p of s.projects) {
    let saved = pending.get(p.id)
    if (!saved) {
      const c = p.conn
      if (c.state === 'idle') continue
      const target = S.isConnected(c) ? { ...c.target, folder: c.target.folder || c.hello.root } : c.target
      const tabs: S.SavedTab[] = []
      let active = -1
      for (const t of p.tabs) {
        const st = saveTab(t)
        if (!st) continue
        if (t.id === p.active) active = tabs.length
        tabs.push(st)
      }
      saved = { target, tabs, active }
    }
    if (p.id === s.project) current = projects.length
    projects.push(saved)
  }
  return { projects, current }
}

function openTab(t: S.SavedTab): S.Tab {
  const tab = openTabOnly(t)
  terminalPanes(tab).forEach((p, i) => t.shells?.[i] && restoreShell(p, t.shells[i]))
  return tab
}

function openTabOnly(t: S.SavedTab): S.Tab {
  const id = S.newId()
  const splits = t.splits?.count ? { dir: t.splits.dir, panes: Array.from({ length: t.splits.count }, () => S.newId('p')) } : undefined
  switch (t.kind) {
    case 'file':
      return { id, kind: 'file', path: t.path, dirty: false, line: t.line, col: t.col, preview: t.preview, splits }
    case 'diff':
      return { id, kind: 'diff', repo: t.repo, change: t.change, preview: t.preview }
    case 'commit':
      return { id, kind: 'commit', repo: t.repo, hash: t.hash, subject: t.subject, preview: t.preview }
    case 'terminal':
      return { id, kind: 'terminal', cwd: t.cwd, splits }
    case 'sql':
      return { id, kind: 'sql', conn: t.conn, text: t.text, splits }
    default:
      return { id, kind: t.kind, splits }
  }
}

export function restoredTabs(id: string, target: S.Target): Pick<S.Project, 'tabs' | 'active'> | null {
  const saved = pending.get(id)
  if (!saved) return null
  pending.delete(id)
  if (!sameTarget(saved.target, target) || saved.tabs.length === 0) return null
  const opened = saved.tabs.map(openTab)
  const tabs = S.withFixed(opened)
  const active = opened[saved.active]
  return { tabs, active: active && !S.isFixed(active) && tabs.includes(active) ? active.id : S.firstOwnTab(tabs).id }
}

let last = ''
let timer: ReturnType<typeof setTimeout> | undefined

function changed(): S.SavedSession | null {
  const session = snapshot()
  const text = JSON.stringify(session)
  if (text === last) return null
  last = text
  return session
}

function save() {
  timer = undefined
  const session = changed()
  if (!session) return
  updateSettings({ session })
  dropOutputsBut(new Set(session.projects.flatMap((p) => p.tabs.flatMap((t) => t.shells?.map((s) => s.key) ?? []))))
}

export function restoreSession(): () => void {
  const saved = S.get().settings.session
  if (saved?.projects.length) {
    const ids = saved.projects.map((_, i) => (i === 0 ? S.get().project : S.addProject()))
    saved.projects.forEach((p, i) => pending.set(ids[i], p))
    S.switchProject(ids[saved.current] ?? ids[0])
    saved.projects.forEach((p, i) => connect(p.target, ids[i]))
  }
  last = JSON.stringify(snapshot())
  const unsub = S.subscribe(() => {
    if (!timer) timer = setTimeout(save, 400)
  })
  return () => {
    unsub()
    clearTimeout(timer)
  }
}

export function saveSessionNow(): Promise<void> {
  flushOutputs()
  clearTimeout(timer)
  timer = undefined
  changed()
  return updateSettings({ session: snapshot() })
}
