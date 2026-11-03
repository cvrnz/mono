import { agentFor, fromBase64, onAgent, toBase64 } from './agent'
import * as S from './store'

type Sink = { data: (bytes: Uint8Array) => void; exit: (code: number) => void; proc?: (name: string) => void }

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
