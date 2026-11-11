import { agentFor, fromBase64, onAgent, toBase64 } from './agent'
import * as S from './store'

type Sink = { data: (bytes: Uint8Array) => void; exit: (code: number) => void; proc?: (name: string) => void; cwd?: (path: string) => void }

const sinks = new Map<string, Sink>()
const early = new Map<string, { data: Uint8Array[]; exit?: number }>()
let listening = false

function listen() {
  if (listening) return
  listening = true
  onAgent('term.data', (p: { id: string; data: string }, project) => {
    const bytes = fromBase64(p.data)
    const key = keyOf(project, p.id)
    const sink = sinks.get(key)
    if (sink) sink.data(bytes)
    else hold(key).data.push(bytes)
  })
  onAgent('term.proc', (p: { id: string; name: string }, project) => sinks.get(keyOf(project, p.id))?.proc?.(p.name))
  onAgent('term.cwd', (p: { id: string; cwd: string }, project) => sinks.get(keyOf(project, p.id))?.cwd?.(p.cwd))
  onAgent('term.exit', (p: { id: string; code: number }, project) => {
    const key = keyOf(project, p.id)
    const sink = sinks.get(key)
    if (sink) sink.exit(p.code)
    else hold(key).exit = p.code
  })
}

const keyOf = (project: string, id: string) => `${project}/${id}`

function hold(id: string) {
  let h = early.get(id)
  if (!h) early.set(id, (h = { data: [] }))
  return h
}

export type Shell = {
  id: string
  shell: string
  write(data: string): void
  writeBinary(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

const encoder = new TextEncoder()

export async function openShell(project: string, cols: number, rows: number, cwd: string, sink: Sink, command?: string): Promise<Shell> {
  listen()
  const agent = agentFor(project)
  const { id, shell } = await agent.termOpen(cols, rows, cwd, command)
  const key = keyOf(project, id)
  sinks.set(key, sink)
  const held = early.get(key)
  if (held) {
    early.delete(key)
    held.data.forEach((d) => sink.data(d))
    if (held.exit !== undefined) sink.exit(held.exit)
  }
  let pending: Uint8Array[] = []
  let sending = false
  const flush = async () => {
    if (sending) return
    sending = true
    while (pending.length) {
      const chunks = pending
      pending = []
      const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let at = 0
      for (const c of chunks) {
        data.set(c, at)
        at += c.length
      }
      await agent.termInput(id, toBase64(data)).catch(() => {})
    }
    sending = false
  }
  return {
    id,
    shell,
    write: (data) => {
      pending.push(encoder.encode(data))
      flush()
    },
    writeBinary: (data) => {
      pending.push(Uint8Array.from(data, (c) => c.charCodeAt(0) & 255))
      flush()
    },
    resize: (c, r) => {
      agent.termResize(id, c, r).catch(() => {})
    },
    close: () => {
      sinks.delete(key)
      if (S.project(project)) agent.termClose(id).catch(() => {})
    },
  }
}

// A terminal pane's output is kept in the webview's storage under a key that outlives the pane, so a
// restarted app can show it again above a new shell in the same folder.
const storagePrefix = 'mono.term.'
const keys = new Map<string, string>()
const restoring = new Map<string, S.SavedShell>()
const flushers = new Map<string, () => void>()

export function shellKey(pane: string): string {
  let key = keys.get(pane)
  if (!key) keys.set(pane, (key = crypto.randomUUID()))
  return key
}

/** Gives a pane opened from a saved session the output it had. */
export function restoreShell(pane: string, saved: S.SavedShell) {
  keys.set(pane, saved.key)
  restoring.set(pane, saved)
}

export function takeRestored(pane: string): { cwd?: string; text: string | null } | null {
  const saved = restoring.get(pane)
  if (!saved) return null
  restoring.delete(pane)
  let text: string | null = null
  try {
    text = localStorage.getItem(storagePrefix + saved.key)
  } catch {
  }
  return { cwd: saved.cwd, text }
}

/** Keeps a pane's output every few seconds while it changes, and when the session is saved on quitting. */
export function keepOutput(pane: string, text: () => string): { changed(): void; stop(): void } {
  let changed = false
  const flush = () => {
    changed = false
    try {
      localStorage.setItem(storagePrefix + shellKey(pane), text())
    } catch {
    }
  }
  flushers.set(pane, flush)
  const timer = setInterval(() => changed && flush(), 3000)
  return {
    changed: () => (changed = true),
    stop: () => {
      clearInterval(timer)
      if (flushers.get(pane) === flush) flushers.delete(pane)
      keys.delete(pane)
    },
  }
}

export function flushOutputs() {
  flushers.forEach((f) => f())
}

/** Forgets the output of panes that aren't in the session anymore. */
export function dropOutputsBut(used: Set<string>) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(storagePrefix) && !used.has(k.slice(storagePrefix.length))) localStorage.removeItem(k)
    }
  } catch {
  }
}
