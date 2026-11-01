import { invoke, on } from './bridge'
import * as S from './store'

async function call<T>(conn: string, method: string, params: unknown = {}): Promise<T> {
  return invoke<T>('call', { conn, method, params })
}

export type Hello = { hostname: string; user: string; home: string; root: string; shell: string }
export type Entry = { name: string; dir: boolean; link: boolean; size: number }
export type ReadResult = { content: string; binary: boolean; tooLarge: boolean; size: number }
export type Change = { status: string; path: string; old?: string }
export type SyncAction = { label: string; verb: string; done: string; dim?: boolean }
export type Repo = {
  path: string
  name: string
  branch: string
  sync: { ahead: number; behind: number } | null
  arrows: string
  remote: string
  count: number
  action: SyncAction | null
}
export type Version = { content: string; binary: boolean }
export type Match = { path: string; line: number; col: number; text: string }

export function agentFor(project: string | (() => string)) {
  const conn = typeof project === 'function' ? project : () => project
  return {
    hello: (root?: string) => call<Hello>(conn(), 'hello', { root }),
    list: (path: string) => call<Entry[]>(conn(), 'fs.list', { path }),
    read: (path: string, limit?: number) => call<ReadResult>(conn(), 'fs.read', { path, limit }),
    write: (path: string, content: string) => call<void>(conn(), 'fs.write', { path, content }),
    create: (path: string, dir: boolean) => call<void>(conn(), 'fs.create', { path, dir }),
    rename: (from: string, to: string) => call<void>(conn(), 'fs.rename', { from, to }),
    remove: (path: string) => call<void>(conn(), 'fs.delete', { path }),
    stat: (path: string) => call<{ exists: boolean; dir: boolean }>(conn(), 'fs.stat', { path }),
    files: (root: string) => call<{ files: string[]; truncated: boolean }>(conn(), 'fs.files', { root }),
    grep: (root: string, query: string) => call<{ matches: Match[]; truncated: boolean }>(conn(), 'fs.grep', { root, query }),
    repos: (roots: string[], depth?: number) => call<Repo[]>(conn(), 'scm.repos', { roots, depth }),
    changes: (repo: string) => call<Change[]>(conn(), 'scm.changes', { repo }),
    versions: (repo: string, change: Change) => call<{ old: Version; new: Version }>(conn(), 'scm.versions', { repo, change }),
    fetch: (repo: string, name: string) => call<Repo>(conn(), 'scm.fetch', { repo, name }),
    sync: (repo: string) => call<void>(conn(), 'scm.sync', { repo }),
    termOpen: (cols: number, rows: number, cwd: string) => call<{ id: string; shell: string }>(conn(), 'term.open', { cols, rows, cwd }),
    termInput: (id: string, data: string) => call<void>(conn(), 'term.input', { id, data }),
    termResize: (id: string, cols: number, rows: number) => call<void>(conn(), 'term.resize', { id, cols, rows }),
    termClose: (id: string) => call<void>(conn(), 'term.close', { id }),
  }
}

export const agent = agentFor(() => S.get().project)

type AgentEvent = { conn: string; event: string; params: any }
type Handler = (params: any, project: string) => void
const handlers = new Map<string, Set<Handler>>()
let listening = false

export function onAgent(event: string, fn: Handler): () => void {
  if (!listening) {
    listening = true
    on('agent:event', (e: AgentEvent) => handlers.get(e.event)?.forEach((h) => h(e.params, e.conn)))
  }
  let set = handlers.get(event)
  if (!set) handlers.set(event, (set = new Set()))
  set.add(fn)
  return () => set.delete(fn)
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
