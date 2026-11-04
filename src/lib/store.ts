import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Change, Hello } from './agent'

export type Target = { kind: 'local'; folder: string } | { kind: 'docker'; container: string; folder: string }

export function localTarget(folder: string): Target {
  return { kind: 'local', folder }
}

export function dockerTarget(container: string, folder: string): Target {
  return { kind: 'docker', container, folder }
}

export type Settings = {
  theme: string
  themeRepos: string[]
  vim: boolean
  lineNumbers: boolean
  maxColumns: number
  gitDepth: number
  fontSize: number
  fontFamily: string
  dockerPath?: string
  recents: Target[]
  sqlConnections?: SqlConnection[]
  sideWidths?: { sidebar?: number; sql?: number }
  sidebar?: FixedKind | 'none'
  tabIcons?: boolean
  iconPack?: 'material' | 'vscode' | 'catppuccin'
  /** Run configurations, by project (see runs.ts targetKey). */
  runConfigs?: Record<string, RunConfig[]>
  wordWrap?: boolean
  gitLog?: boolean
  session?: SavedSession
}

export type SavedTab = (
  | { kind: 'file'; path: string; line?: number; col?: number; preview?: boolean }
  | { kind: 'diff'; repo: string; change: Change; preview?: boolean }
  | { kind: 'commit'; repo: string; hash: string; subject: string; preview?: boolean }
  | { kind: 'terminal'; cwd: string }
  | { kind: 'scm' }
  | { kind: 'welcome' }
  | { kind: 'explorer' }
  | { kind: 'search' }
  | { kind: 'run' }
  | { kind: 'sql'; conn?: string; text?: string }
) & { splits?: { dir: Splits['dir']; count: number } }

export type SavedProject = { target: Target; tabs: SavedTab[]; active: number }
export type SavedSession = { projects: SavedProject[]; current: number }

export const defaultSettings: Settings = {
  theme: 'monomyth-dark',
  themeRepos: ['cvrnz/monomyth-dark-theme'],
  vim: true,
  lineNumbers: true,
  maxColumns: 120,
  gitDepth: 4,
  fontSize: 16,
  fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
  recents: [],
}

export type SqlEngine = 'postgres' | 'mysql' | 'mssql' | 'sqlite'

export type RunConfig = { name: string; command: string; cwd?: string }
export type RunState = 'starting' | 'running' | 'done' | 'failed' | 'stopped'
export type Run = { id: string; project: string; name: string; command: string; cwd: string; state: RunState; code?: number; started: number; ended?: number }

export type SqlConnection = {
  name: string
  engine: SqlEngine
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  file?: string
  ssl?: boolean
  trustCert?: boolean
}

export type Splits = { dir: 'below' | 'right'; panes: string[] }

type TabBase = { id: string; splits?: Splits; focus?: string; preview?: boolean }
export type FileTab = TabBase & { kind: 'file'; path: string | null; dirty: boolean; line?: number; col?: number; len?: number }
export type DiffTab = TabBase & { kind: 'diff'; repo: string; change: Change }
export type CommitTab = TabBase & { kind: 'commit'; repo: string; hash: string; subject: string }
export type TerminalTab = TabBase & { kind: 'terminal'; cwd: string }
export type ScmTab = TabBase & { kind: 'scm' }
export type WelcomeTab = TabBase & { kind: 'welcome' }
export type ExplorerTab = TabBase & { kind: 'explorer' }
export type SqlTab = TabBase & { kind: 'sql'; conn?: string; text?: string }
export type SearchKind = 'files' | 'text'
export type SearchTab = TabBase & { kind: 'search'; ask?: { kind: SearchKind; text: string; n: number } }
export type RunTab = TabBase & { kind: 'run' }
export type Tab = FileTab | DiffTab | CommitTab | TerminalTab | ScmTab | WelcomeTab | ExplorerTab | SqlTab | SearchTab | RunTab

export const fixedKinds = ['explorer', 'scm', 'run', 'search'] as const
export type FixedKind = (typeof fixedKinds)[number]

export function isFixed(t: Tab): boolean {
  return (fixedKinds as readonly string[]).includes(t.kind)
}

export function withFixed(tabs: Tab[]): Tab[] {
  const fixed = fixedKinds.map((kind) => tabs.find((t) => t.kind === kind) ?? ({ id: newId(), kind } as Tab))
  const rest = tabs.filter((t) => !isFixed(t))
  return [...fixed, ...(rest.length ? rest : [{ id: newId(), kind: 'welcome' } as WelcomeTab])]
}

export function firstOwnTab(tabs: Tab[]): Tab {
  return tabs.find((t) => !isFixed(t)) ?? tabs[0]
}

export function sidebar(s: State = state): FixedKind | null {
  const v = s.settings.sidebar ?? 'explorer'
  return v === 'none' ? null : v
}

export type Connection =
  | { state: 'idle'; error?: string }
  | { state: 'connecting'; status: string; target: Target }
  | { state: 'connected'; hello: Hello; target: Target }
  | { state: 'lost'; hello: Hello; target: Target; error: string; reconnecting?: boolean }

export type PaneStatus = { mode?: string; items: string[]; errors?: number; warnings?: number }

export type Project = {
  id: string
  conn: Connection
  tabs: Tab[]
  active: string | null
  session: number
}

const projectKeys = ['conn', 'tabs', 'active', 'session'] as const
type ProjectFields = Pick<Project, (typeof projectKeys)[number]>

function blankProject(id: string): Project {
  return { id, conn: { state: 'idle' }, tabs: [], active: null, session: 0 }
}

export type State = {
  platform: string
  settings: Settings
  project: string
  projects: Project[]
  conn: Connection
  tabs: Tab[]
  active: string | null
  palette: null | { mode: 'commands' | 'themes' | 'icons'; text?: string }
  status: Record<string, PaneStatus>
  previewTheme: string | null
  previewIcons: string | null
  /** What each terminal pane is running, by pane id. */
  procs: Record<string, string>
  runs: Run[]
  /** The run whose output covers the panes, if any. */
  runView: string | null
  session: number
  draggingTab: string | null
  hints: Record<string, string[]>
}

const first = blankProject('w0')

let state: State = {
  platform: 'darwin',
  settings: defaultSettings,
  project: first.id,
  projects: [first],
  conn: { state: 'idle' },
  tabs: [],
  active: null,
  palette: null,
  status: {},
  previewTheme: null,
  previewIcons: null,
  procs: {},
  runs: [],
  runView: null,
  session: 0,
  draggingTab: null,
  hints: {},
}

const listeners = new Set<() => void>()

export function get(): State {
  return state
}

export function set(update: Partial<State> | ((s: State) => Partial<State>)) {
  const patch = typeof update === 'function' ? update(state) : update
  const next = { ...state, ...patch }
  if (projectKeys.some((k) => k in patch)) {
    const fields: ProjectFields = { conn: next.conn, tabs: next.tabs, active: next.active, session: next.session }
    next.projects = next.projects.map((p) => (p.id === next.project ? { ...p, ...fields } : p))
  }
  state = next
  listeners.forEach((l) => l())
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}

let nextId = 0
export function newId(prefix = 't'): string {
  return `${prefix}${++nextId}`
}

export function setHints(id: string, items: string[] | null) {
  set((s) => {
    const hints = { ...s.hints }
    if (items) hints[id] = items
    else delete hints[id]
    return { hints }
  })
}

export function setPaneStatus(id: string, status: PaneStatus) {
  set((s) => ({ status: { ...s.status, [id]: status } }))
}

export function updateTab(id: string, patch: Partial<Tab>) {
  const pid = projectOfTab(id) ?? state.project
  setProject(pid, (p) => ({ tabs: p.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) }))
}

export function project(id: string): Project | undefined {
  return state.projects.find((p) => p.id === id)
}

export function currentProject(): Project {
  return project(state.project)!
}

export function setProject(id: string, update: Partial<ProjectFields> | ((p: Project) => Partial<ProjectFields>)) {
  const p = project(id)
  if (!p) return
  const patch = typeof update === 'function' ? update(p) : update
  if (id === state.project) set(patch)
  else set((s) => ({ projects: s.projects.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
}

export function projectOfTab(id: string): string | undefined {
  return state.projects.find((p) => p.tabs.some((t) => t.id === id || t.splits?.panes.includes(id)))?.id
}

export function switchProject(id: string) {
  const p = project(id)
  if (!p || id === state.project) return
  set({ project: id, conn: p.conn, tabs: p.tabs, active: p.active, session: p.session, palette: null })
}

export function addProject(): string {
  const p = blankProject(newId('w'))
  set((s) => ({ projects: [...s.projects, p] }))
  switchProject(p.id)
  return p.id
}

export function removeProject(id: string) {
  const i = state.projects.findIndex((p) => p.id === id)
  if (i < 0) return
  if (state.projects.length === 1) {
    const p = blankProject(newId('w'))
    set({ projects: [p], project: p.id, ...fieldsOf(p), palette: null, status: {} })
    return
  }
  if (id === state.project) switchProject(state.projects[i === 0 ? 1 : i - 1].id)
  set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }))
}

function fieldsOf(p: Project): ProjectFields {
  return { conn: p.conn, tabs: p.tabs, active: p.active, session: p.session }
}

export function isConnected(c: Connection): c is Extract<Connection, { state: 'connected' | 'lost' }> {
  return c.state === 'connected' || c.state === 'lost'
}

const gone = blankProject('')

export const ProjectContext = createContext('')

export function useProjectId(): string {
  return useContext(ProjectContext) || state.project
}

export function useProject<T>(selector: (p: Project) => T): T {
  const id = useProjectId()
  return useStore((s) => selector(s.projects.find((p) => p.id === id) ?? gone))
}

export function activeTab(): Tab | undefined {
  return state.tabs.find((t) => t.id === state.active)
}

export function focusedPane(tab: Tab): string {
  return tab.focus && tab.splits?.panes.includes(tab.focus) ? tab.focus : tab.id
}

export const isMac = () => state.platform === 'darwin'

export function connected(): Hello | null {
  const c = state.conn
  return c.state === 'connected' || c.state === 'lost' ? c.hello : null
}
