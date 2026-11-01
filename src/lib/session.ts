import { connect, sameTarget } from './connection'
import { pane } from './panes'
import { updateSettings } from './settings'
import * as S from './store'

const pending = new Map<string, S.SavedProject>()
const cursors = new Map<string, { line: number; col: number }>()

function saveTab(t: S.Tab): S.SavedTab | null {
  const splits = t.splits ? { dir: t.splits.dir, count: t.splits.panes.length } : undefined
  switch (t.kind) {
    case 'file': {
      if (!t.path) return null
      const pos = pane(t.id)?.editor?.getPosition()
      if (pos) cursors.set(t.id, { line: pos.lineNumber, col: pos.column - 1 })
      const c = cursors.get(t.id) ?? (t.line ? { line: t.line, col: t.col ?? 0 } : undefined)
      return { kind: 'file', path: t.path, ...c, splits }
    }
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
  const id = S.newId()
  const splits = t.splits?.count ? { dir: t.splits.dir, panes: Array.from({ length: t.splits.count }, () => S.newId('p')) } : undefined
  switch (t.kind) {
    case 'file':
      return { id, kind: 'file', path: t.path, dirty: false, line: t.line, col: t.col, splits }
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
  return { tabs, active: active && tabs.includes(active) ? active.id : S.firstOwnTab(tabs).id }
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
  if (session) updateSettings({ session })
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
  clearTimeout(timer)
  timer = undefined
  changed()
  return updateSettings({ session: snapshot() })
}
