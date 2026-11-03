import { errorText } from './bridge'
import { isInside, join } from './paths'
import { updateSettings } from './settings'
import * as S from './store'
import { openShell, type Shell } from './terminals'

type Live = { shell?: Shell; chunks: Uint8Array[]; size: number; listeners: Set<(b: Uint8Array) => void>; config: S.RunConfig; stopping?: number }

const live = new Map<string, Live>()
const MAX_OUTPUT = 4 << 20
const encoder = new TextEncoder()

export function targetKey(t: S.Target): string {
  return t.kind === 'docker' ? `docker:${t.container}:${t.folder}` : `local:${t.folder}`
}

function currentKey(): string | null {
  const c = S.get().conn
  return c.state === 'idle' ? null : targetKey(c.target)
}

const none: S.RunConfig[] = []
export function configs(s: S.State = S.get()): S.RunConfig[] {
  const key = currentKey()
  return (key && s.settings.runConfigs?.[key]) || none
}

export function saveConfigs(list: S.RunConfig[]) {
  const key = currentKey()
  if (!key) return
  const all = { ...S.get().settings.runConfigs }
  if (list.length) all[key] = list
  else delete all[key]
  updateSettings({ runConfigs: all })
}

function update(id: string, patch: Partial<S.Run>) {
  S.set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
}

const runOf = (id: string) => S.get().runs.find((r) => r.id === id)

function write(id: string, bytes: Uint8Array) {
  const l = live.get(id)
  if (!l) return
  l.chunks.push(bytes)
  l.size += bytes.length
  while (l.size > MAX_OUTPUT && l.chunks.length > 1) l.size -= l.chunks.shift()!.length
  l.listeners.forEach((f) => f(bytes))
}
const say = (id: string, text: string) => write(id, encoder.encode(text))

function finish(id: string, state: S.RunState, code?: number) {
  const r = runOf(id)
  if (!r || (r.state !== 'running' && r.state !== 'starting')) return
  const l = live.get(id)
  clearTimeout(l?.stopping)
  const color = state === 'done' ? '32' : state === 'stopped' ? '33' : '31'
  say(id, `\r\n\x1b[${color}m[${state === 'stopped' ? 'Stopped' : `Exited ${code ?? ''}`.trim()}]\x1b[0m\r\n`)
  update(id, { state, code, ended: Date.now() })
  l?.shell?.close()
}

export async function start(config: S.RunConfig, project = S.get().project): Promise<string | null> {
  const p = S.project(project)
  if (!p || !S.isConnected(p.conn)) return null
  const root = p.conn.hello.root
  const dir = config.cwd?.trim()
  const cwd = !dir ? root : dir.startsWith('/') ? dir : join(root, dir)
  const id = S.newId('run')
  live.set(id, { chunks: [], size: 0, listeners: new Set(), config })
  S.set((s) => ({ runs: [{ id, project, name: config.name, command: config.command, cwd, state: 'starting', started: Date.now() }, ...s.runs] }))
  say(id, `\x1b[2m${isInside(cwd, root) && cwd !== root ? cwd.slice(root.length + 1) + ' ' : ''}$ ${config.command}\x1b[0m\r\n`)
  try {
    const shell = await openShell(
      project,
      120,
      30,
      cwd,
      { data: (b) => write(id, b), exit: (code) => finish(id, live.get(id)?.stopping ? 'stopped' : code === 0 ? 'done' : 'failed', code) },
      config.command,
    )
    const l = live.get(id)
    if (!l || runOf(id)?.state !== 'starting') {
      shell.close()
      return id
    }
    l.shell = shell
    update(id, { state: 'running' })
  } catch (err) {
    say(id, `\x1b[31m${errorText(err)}\x1b[0m\r\n`)
    update(id, { state: 'failed', ended: Date.now() })
  }
  return id
}

/** Ctrl+C first, the way you'd stop it in a terminal; closes it if it is still going after a moment. */
export function stop(id: string) {
  const l = live.get(id)
  const r = runOf(id)
  if (!l || !r || (r.state !== 'running' && r.state !== 'starting')) return
  if (l.stopping) return finish(id, 'stopped')
  l.shell?.write('\x03')
  l.stopping = window.setTimeout(() => finish(id, 'stopped'), 1500)
}

export function rerun(id: string) {
  const l = live.get(id)
  const r = runOf(id)
  if (!l || !r) return
  dismiss(id)
  start(l.config, r.project).then((next) => next && S.get().runView === id && S.set({ runView: next }))
}

export function dismiss(id: string) {
  const r = runOf(id)
  if (r && (r.state === 'running' || r.state === 'starting')) live.get(id)?.shell?.close()
  live.delete(id)
  S.set((s) => ({ runs: s.runs.filter((x) => x.id !== id), runView: s.runView === id ? null : s.runView }))
}

/** Replays what the run printed so far, then passes on what comes next. */
export function watch(id: string, fn: (b: Uint8Array) => void): () => void {
  const l = live.get(id)
  if (!l) return () => {}
  l.chunks.forEach(fn)
  l.listeners.add(fn)
  return () => l.listeners.delete(fn)
}

export function resize(id: string, cols: number, rows: number) {
  live.get(id)?.shell?.resize(cols, rows)
}

export function show(id: string | null) {
  S.set({ runView: id })
}

let seen = { active: S.get().active, project: S.get().project }
S.subscribe(() => {
  const s = S.get()
  if (s.active !== seen.active || s.project !== seen.project) {
    seen = { active: s.active, project: s.project }
    if (s.runView) S.set({ runView: null })
  }
  for (const r of s.runs) {
    if (r.state !== 'running' && r.state !== 'starting') continue
    const p = S.project(r.project)
    if (!p || p.conn.state === 'lost' || p.conn.state === 'idle') finish(r.id, 'stopped')
  }
})
