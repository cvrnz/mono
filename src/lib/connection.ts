import { agentFor } from './agent'
import { errorText, invoke, on } from './bridge'
import { open } from '@tauri-apps/plugin-dialog'
import { choose, prompt, toast } from './dialogs'
import { join, normalize, pretty } from './paths'
import { dirtyCount, focusActive, saveAll } from './actions'
import { restoredTabs } from './session'
import { updateSettings } from './settings'
import * as S from './store'

let listening = false
const attempts = new Map<string, number>()

function listen() {
  if (listening) return
  listening = true
  on('agent:status', ({ conn: id, status }: { conn: string; status: string }) => {
    S.setProject(id, (p) => (p.conn.state === 'connecting' ? { conn: { ...p.conn, status } } : {}))
  })
  on('agent:closed', ({ conn: id, error }: { conn: string; error: string }) => {
    const c = S.project(id)?.conn
    if (c?.state !== 'connected') return
    S.setProject(id, { conn: { state: 'lost', hello: c.hello, target: c.target, error: error || 'disconnected' } })
    if (!attempts.get(id)) {
      attempts.set(id, 1)
      setTimeout(() => reconnect(id), 1000)
    }
  })
}

export function sameTarget(a: S.Target, b: S.Target) {
  if (a.kind === 'local' || b.kind === 'local') return a.kind === b.kind && a.folder === b.folder
  return a.container === b.container && a.folder === b.folder
}

function remember(target: S.Target) {
  const recents = [target, ...S.get().settings.recents.filter((r) => !sameTarget(r, target))].slice(0, 8)
  updateSettings({ recents })
}

export function forget(target: S.Target) {
  updateSettings({ recents: S.get().settings.recents.filter((r) => !sameTarget(r, target)) })
}

export async function connect(target: S.Target, id = S.get().project) {
  listen()
  S.setProject(id, { conn: { state: 'connecting', status: 'Connecting…', target } })
  try {
    await invoke('connect', { target, conn: id })
    const hello = await agentFor(id).hello(target.folder || undefined)
    if (!S.project(id)) {
      invoke('disconnect', { conn: id }).catch(() => {})
      return
    }
    attempts.delete(id)
    const resolved = target.kind === 'local' ? { ...target, folder: hello.root } : target
    S.setProject(id, (p) => ({ conn: { state: 'connected', hello, target: resolved }, session: p.session + 1 }))
    remember({ ...resolved, folder: resolved.folder || hello.root })
    const restored = restoredTabs(id, resolved)
    if (restored) {
      S.setProject(id, restored)
      if (id === S.get().project) focusActive()
    } else if (S.project(id)!.tabs.length === 0) {
      const tabs = S.withFixed([])
      S.setProject(id, { tabs, active: tabs[2].id })
      if (id === S.get().project) focusActive()
    }
  } catch (err) {
    invoke('disconnect', { conn: id }).catch(() => {})
    if (S.project(id)) S.setProject(id, { conn: { state: 'idle', error: errorText(err) } })
  }
}

export async function reconnect(id = S.get().project) {
  const c = S.project(id)?.conn
  if (c?.state !== 'lost' || c.reconnecting) return
  S.setProject(id, { conn: { ...c, reconnecting: true } })
  try {
    await invoke('connect', { target: c.target, conn: id })
    const hello = await agentFor(id).hello(c.hello.root)
    attempts.delete(id)
    S.setProject(id, (p) => ({ conn: { state: 'connected', hello, target: c.target }, session: p.session + 1 }))
  } catch (err) {
    const now = S.project(id)?.conn
    if (now?.state === 'lost') S.setProject(id, { conn: { ...now, reconnecting: false, error: errorText(err) } })
  }
}

export async function changeDirectory(path = '') {
  const id = S.get().project
  const c = S.project(id)?.conn
  if (c?.state !== 'connected') {
    toast('Connect first', 'error')
    return
  }
  let dir: string | null = path.trim()
  if (!dir) {
    dir =
      c.target.kind === 'local'
        ? await open({ directory: true, defaultPath: c.hello.root, title: 'Change directory' }).catch(() => null)
        : await prompt('Change directory', pretty(c.hello.root, '', c.hello.home), 'A folder in the container')
    dir = dir?.trim() || null
  }
  if (!dir) return
  if (!dir.startsWith('/') && !dir.startsWith('~')) dir = normalize(join(c.hello.root, dir))
  try {
    const hello = await agentFor(id).hello(dir)
    const now = S.project(id)?.conn
    if (now?.state !== 'connected') return
    const target = { ...now.target, folder: hello.root }
    S.setProject(id, { conn: { state: 'connected', hello, target } })
    remember(target)
    toast(`Now in ${pretty(hello.root, '', hello.home)}`)
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

export function newProject() {
  S.addProject()
}

export async function disconnect() {
  const id = S.get().project
  const n = dirtyCount()
  if (n > 0) {
    const choice = await choose(
      n === 1 ? 'Save changes to 1 file before disconnecting?' : `Save changes to ${n} files before disconnecting?`,
      "Your changes will be lost if you don't save them.",
      [
        { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
        { label: "Don't save", value: 'discard', variant: 'secondary' },
        { label: 'Save all', value: 'save', variant: 'primary' },
      ],
    )
    if (choice === 'cancel') return
    if (choice === 'save' && !(await saveAll())) return
  }
  closeProject(id)
}

export function closeProject(id: string) {
  attempts.delete(id)
  S.removeProject(id)
  invoke('disconnect', { conn: id }).catch(() => {})
  focusActive()
}
