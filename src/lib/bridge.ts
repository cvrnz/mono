import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type Listener = (data: any) => void

export function invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args).catch((e) => {
    throw new Error(errorText(e))
  })
}

export function on(event: string, fn: Listener): () => void {
  let stop: (() => void) | undefined
  let stopped = false
  listen(event, (e) => fn(e.payload)).then((un) => {
    if (stopped) un()
    else stop = un
  })
  return () => {
    stopped = true
    stop?.()
  }
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return
  }
}

export async function pasteText(): Promise<string> {
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}
