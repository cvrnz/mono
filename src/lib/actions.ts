import { agent, type Change, type Commit } from './agent'
import { errorText, invoke } from './bridge'
import { choose, prompt, toast } from './dialogs'
import { pane } from './panes'
import { saveSessionNow } from './session'
import { updateSettings } from './settings'
import { basename, join, normalize } from './paths'
import * as S from './store'

export function root(): string {
  return S.connected()?.root ?? '/'
}

function insertTab(tab: S.Tab) {
  S.set((s) => {
    const tabs = [...s.tabs]
    const fixed = tabs.filter(S.isFixed).length
    const i = tabs.findIndex((t) => t.id === s.active)
    tabs.splice(Math.max(i + 1, fixed), 0, tab)
    return { tabs, active: tab.id }
  })
}

function replaceTab(id: string, tab: S.Tab) {
  S.set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? tab : t)), active: tab.id }))
}

function isEmpty(tab: S.Tab | undefined): boolean {
  if (!tab || tab.splits) return false
  if (tab.kind === 'welcome') return true
  return tab.kind === 'file' && tab.path === null && !tab.dirty && (pane(tab.id)?.isEmpty?.() ?? true)
}

function emptySpot(): S.Tab | undefined {
  const current = S.activeTab()
  if (isEmpty(current)) return current
  const mine = S.get().tabs.filter((t) => !S.isFixed(t))
  if (current && S.isFixed(current) && mine.length === 1 && isEmpty(mine[0])) return mine[0]
}

export function activate(id: string) {
  S.set({ active: id, runView: null })
  focusActive()
}

export function focusActive() {
  const tab = S.activeTab()
  if (!tab) return
  requestAnimationFrame(() => {
    // A command run from the palette may have opened it again (Themes, IconPacks), so leave its input focused.
    if (!S.get().palette) pane(S.focusedPane(tab))?.focus()
  })
}

export type OpenOptions = { preview?: boolean; focus?: boolean }

export function sidebarFocused(): boolean {
  return Boolean(document.activeElement?.closest('.sidebar'))
}

function show(tab: S.Tab, existing: S.Tab | undefined, opts: OpenOptions) {
  const focus = opts.focus ?? true
  if (focus && sidebarFocused()) (document.activeElement as HTMLElement).blur()
  if (existing) {
    S.set({ active: existing.id })
    if (existing.preview && !opts.preview) S.updateTab(existing.id, { preview: false })
  } else if (opts.preview) {
    const drop = new Set([S.get().tabs.find((t) => t.preview)?.id, emptySpot()?.id])
    S.set((s) => ({ tabs: [...s.tabs.filter((t) => !drop.has(t.id)), tab], active: tab.id }))
  } else {
    const spot = emptySpot()
    if (spot) replaceTab(spot.id, tab)
    else insertTab(tab)
  }
  if (focus) focusActive()
}

export function openFile(path: string, line?: number, col?: number, opts: OpenOptions & { len?: number } = {}) {
  path = normalize(path)
  const existing = S.get().tabs.find((t) => t.kind === 'file' && t.path === path)
  show({ id: S.newId(), kind: 'file', path, dirty: false, line, col, len: opts.len, preview: opts.preview }, existing, opts)
  if (existing && line) pane(existing.id)?.reveal?.(line, col, opts.len)
}

export function openDiff(repo: string, change: Change, opts: OpenOptions = {}) {
  const existing = S.get().tabs.find((t) => t.kind === 'diff' && t.repo === repo && t.change.path === change.path)
  if (existing) S.updateTab(existing.id, { change })
  show({ id: S.newId(), kind: 'diff', repo, change, preview: opts.preview }, existing, opts)
}

export function openCommit(repo: string, c: Commit, opts: OpenOptions = {}) {
  const existing = S.get().tabs.find((t) => t.kind === 'commit' && t.repo === repo && t.hash === c.hash)
  show({ id: S.newId(), kind: 'commit', repo, hash: c.hash, subject: c.subject, preview: opts.preview }, existing, opts)
}

export function toggleWordWrap() {
  const wordWrap = !S.get().settings.wordWrap
  updateSettings({ wordWrap })
  toast(wordWrap ? 'Word wrap on' : 'Word wrap off')
}

export function keepTab(id: string) {
  const tab = S.get().tabs.find((t) => t.id === id)
  if (tab?.preview) S.updateTab(id, { preview: false })
}

export function newTab() {
  insertTab({ id: S.newId(), kind: 'file', path: null, dirty: false })
}

export function newFileHere() {
  const tab: S.FileTab = { id: S.newId(), kind: 'file', path: null, dirty: false }
  const current = S.activeTab()
  if (current?.kind === 'welcome' && !current.splits) replaceTab(current.id, tab)
  else insertTab(tab)
}

export function openWelcome() {
  const tab: S.WelcomeTab = { id: S.newId(), kind: 'welcome' }
  const spot = emptySpot()
  if (spot) replaceTab(spot.id, tab)
  else insertTab(tab)
}

export function openTerminal() {
  insertTab({ id: S.newId(), kind: 'terminal', cwd: root() })
}

export function splitTerminal(dir: S.Splits['dir']) {
  const tab = S.activeTab()
  if (!tab) return openTerminal()
  const id = S.newId('p')
  const panes = [...(tab.splits?.panes ?? []), id]
  S.updateTab(tab.id, { splits: { dir, panes }, focus: id })
}

function sidebarTab(kind = S.sidebar()): S.Tab | undefined {
  return kind ? S.get().tabs.find((t) => t.kind === kind) : undefined
}

export function focusSidebar() {
  const tab = sidebarTab()
  if (tab) requestAnimationFrame(() => pane(tab.id)?.focus())
}

export const explorerRefreshers = new Set<() => void>()
export function refreshExplorer() {
  if (!explorerRefreshers.size) showSidebar('explorer', false)
  explorerRefreshers.forEach((f) => f())
}

export function showSidebar(kind: S.FixedKind | null, focus = true) {
  S.set({ palette: null })
  if (S.sidebar() !== kind) updateSettings({ sidebar: kind ?? 'none' })
  if (kind && focus) focusSidebar()
  else if (!kind) focusActive()
}

export function clickSidebarTab(kind: S.FixedKind) {
  showSidebar(S.sidebar() === kind ? null : kind)
}

function toggleFixed(kind: S.FixedKind) {
  showSidebar(S.sidebar() === kind ? null : kind)
}

export const openExplorer = () => toggleFixed('explorer')
export const openScm = () => toggleFixed('scm')
export const toggleRun = () => toggleFixed('run')
export function toggleGitLog() {
  const show = S.get().settings.gitLog === false
  updateSettings({ gitLog: show })
  if (show) showSidebar('scm', false)
}
export const toggleSearch = () => toggleFixed('search')

/** ⌘F: find in the file or terminal in front. */
export function findInPane() {
  const tab = S.activeTab()
  const viewing = S.get().runView && pane('run-view')
  if (viewing) return viewing.find?.()
  if (!tab || S.isFixed(tab)) return
  const h = pane(S.focusedPane(tab)) ?? pane(tab.id)
  if (h?.find) return h.find()
  const ed = h?.editor
  if (!ed) return
  ed.focus()
  ed.getAction('actions.find')?.run()
}
export const toggleSidebar = () => showSidebar(S.sidebar() ? null : lastSidebar)

let lastSidebar: S.FixedKind = 'explorer'
S.subscribe(() => {
  const kind = S.sidebar()
  if (kind) lastSidebar = kind
})

let asks = 0
export function openSearch(kind: S.SearchKind, text = '') {
  const target = sidebarTab('search')
  if (!target) return
  S.updateTab(target.id, { ask: { kind, text, n: ++asks } })
  showSidebar('search')
}

export function openSql(conn?: string) {
  insertTab({ id: S.newId(), kind: 'sql', conn })
}

export function cycleTab(step: number) {
  const { active } = S.get()
  const tabs = S.get().tabs.filter((t) => !S.isFixed(t))
  if (tabs.length === 0) return
  const i = tabs.findIndex((t) => t.id === active)
  activate(tabs[(i + step + tabs.length) % tabs.length].id)
}

export function focusPane(tabId: string, paneId: string) {
  const tab = S.get().tabs.find((t) => t.id === tabId)
  if (tab && tab.focus !== paneId) S.updateTab(tabId, { focus: paneId })
}

export function cyclePane(step: number) {
  const tab = S.activeTab()
  if (!tab) return
  const side = sidebarTab()
  const focused = side && sidebarFocused() ? side.id : S.focusedPane(tab)
  if (pane(focused)?.step?.(step)) return
  const all = [...(side ? [side.id] : []), tab.id, ...(tab.splits?.panes ?? [])]
  const i = all.indexOf(focused)
  const next = all[(i + step + all.length) % all.length]
  if (next !== side?.id && next !== S.focusedPane(tab)) S.updateTab(tab.id, { focus: next })
  requestAnimationFrame(() => {
    const h = pane(next)
    if (h?.enter) h.enter(step)
    else h?.focus()
  })
}

export async function closeFocused() {
  const tab = S.activeTab()
  if (!tab) return
  const focused = S.focusedPane(tab)
  if (focused !== tab.id) closePane(tab.id, focused)
  else await closeTab(tab.id)
}

export function closePane(tabId: string, paneId: string) {
  const tab = S.get().tabs.find((t) => t.id === tabId)
  if (!tab?.splits) return
  const panes = tab.splits.panes.filter((p) => p !== paneId)
  S.updateTab(tabId, { splits: panes.length ? { ...tab.splits, panes } : undefined, focus: tabId })
  focusActive()
}

async function settle(tab: S.Tab): Promise<boolean> {
  if (tab.kind !== 'file' || !tab.dirty) return true
  const name = tab.path ? basename(tab.path) : 'Untitled'
  const choice = await choose(`Save changes to ${name}?`, "Your changes will be lost if you don't save them.", [
    { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
    { label: "Don't save", value: 'discard', variant: 'secondary' },
    { label: 'Save', value: 'save', variant: 'primary' },
  ])
  if (choice === 'save') return (await pane(tab.id)?.save?.()) ?? false
  return choice === 'discard'
}

export async function closeTab(id: string) {
  const tab = S.get().tabs.find((t) => t.id === id)
  if (!tab || S.isFixed(tab) || !(await settle(tab))) return
  const { tabs, active } = S.get()
  const i = tabs.findIndex((t) => t.id === id)
  if (tab.splits) {
    const [first, ...rest] = tab.splits.panes
    const promoted: S.TerminalTab = {
      id: first,
      kind: 'terminal',
      cwd: root(),
      splits: rest.length ? { ...tab.splits, panes: rest } : undefined,
    }
    S.set({ tabs: tabs.map((t) => (t.id === id ? promoted : t)), active: active === id ? first : active })
    focusActive()
    return
  }
  const remaining = tabs.filter((t) => t.id !== id)
  if (!remaining.some((t) => !S.isFixed(t))) {
    const welcome: S.WelcomeTab = { id: S.newId(), kind: 'welcome' }
    S.set({ tabs: [...remaining, welcome], active: welcome.id })
    focusActive()
    return
  }
  const before = tabs.slice(0, i).filter((t) => !S.isFixed(t)).pop()
  const after = tabs.slice(i + 1).find((t) => !S.isFixed(t))
  const nextActive = active === id ? (before ?? after)!.id : active
  S.set({ tabs: remaining, active: nextActive })
  focusActive()
}

export async function save(as = false) {
  const tab = S.activeTab()
  if (!tab) return
  const target = pane(S.focusedPane(tab))
  if (target?.save) await target.save(as)
}

export async function saveAll(everywhere = false): Promise<boolean> {
  const tabs = everywhere ? S.get().projects.flatMap((p) => p.tabs) : S.get().tabs
  for (const tab of tabs) {
    if (tab.kind === 'file' && tab.dirty) {
      if (!(await pane(tab.id)?.save?.())) return false
    }
  }
  return true
}

export async function askPath(title: string, initial = ''): Promise<string | null> {
  const hello = S.connected()
  const value = await prompt(title, initial, `Relative to ${hello?.root ?? '/'}`)
  if (!value?.trim()) return null
  return resolvePath(value.trim())
}

export function resolvePath(value: string): string {
  const hello = S.connected()
  if (value === '~' || value.startsWith('~/')) return join(hello?.home ?? '/', value.slice(1))
  return join(root(), value)
}

export async function okToWrite(path: string): Promise<boolean> {
  try {
    const st = await agent.stat(path)
    if (st.dir) {
      toast(`${path} is a folder`, 'error')
      return false
    }
    if (!st.exists) return true
  } catch (err) {
    toast(errorText(err), 'error')
    return false
  }
  const choice = await choose(`${basename(path)} already exists`, 'Do you want to replace it?', [
    { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
    { label: 'Replace', value: 'replace', variant: 'danger' },
  ])
  return choice === 'replace'
}

export function dirtyCount(everywhere = false): number {
  const tabs = everywhere ? S.get().projects.flatMap((p) => p.tabs) : S.get().tabs
  return tabs.filter((t) => t.kind === 'file' && t.dirty).length
}

export function switchToProject(index: number) {
  const p = S.get().projects[index]
  if (!p) return
  S.switchProject(p.id)
  focusActive()
}

let quitting = false
export async function quit() {
  if (quitting) return
  quitting = true
  try {
    await askAndQuit()
  } finally {
    quitting = false
  }
}

async function askAndQuit() {
  const n = dirtyCount(true)
  if (n > 0) {
    const choice = await choose(
      n === 1 ? 'Save changes to 1 file before quitting?' : `Save changes to ${n} files before quitting?`,
      "Your changes will be lost if you don't save them.",
      [
        { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
        { label: "Don't save", value: 'discard', variant: 'secondary' },
        { label: 'Save all', value: 'save', variant: 'primary' },
      ],
    )
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveAll(true))) return
  }
  await saveSessionNow()
  await invoke('quit')
}
