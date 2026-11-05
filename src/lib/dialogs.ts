import { useSyncExternalStore } from 'react'

export type Button = { label: string; value: string; variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' }

export type Dialog =
  | { kind: 'choose'; title: string; message?: string; buttons: Button[]; cancel: string; resolve: (v: string) => void }
  | { kind: 'prompt'; title: string; message?: string; value: string; select?: [number, number]; resolve: (v: string | null) => void }

let current: Dialog | null = null
const listeners = new Set<() => void>()

function show(d: Dialog | null) {
  current = d
  listeners.forEach((l) => l())
}

export function useDialog(): Dialog | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}

export function isDialogOpen(): boolean {
  return current !== null
}

export function choose(title: string, message: string | undefined, buttons: Button[], cancel = 'cancel'): Promise<string> {
  return new Promise((resolve) => {
    show({
      kind: 'choose',
      title,
      message,
      buttons,
      cancel,
      resolve: (v) => {
        show(null)
        resolve(v)
      },
    })
  })
}

export async function confirm(title: string, message?: string, ok = 'OK', danger = false): Promise<boolean> {
  const v = await choose(title, message, [
    { label: 'Cancel', value: 'cancel', variant: 'tertiary' },
    { label: ok, value: 'ok', variant: danger ? 'danger' : 'primary' },
  ])
  return v === 'ok'
}

export function prompt(title: string, value = '', message?: string, select?: [number, number]): Promise<string | null> {
  return new Promise((resolve) => {
    show({
      kind: 'prompt',
      title,
      message,
      value,
      select,
      resolve: (v) => {
        show(null)
        resolve(v)
      },
    })
  })
}

export type Toast = { id: number; text: string; tone: 'error' | 'info' }
let toasts: Toast[] = []
const toastListeners = new Set<() => void>()
let toastId = 0

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn)
      return () => toastListeners.delete(fn)
    },
    () => toasts,
  )
}

/** Every error shown this session, oldest first. */
export const errorLog: { time: Date; text: string }[] = []

export function toast(text: string, tone: Toast['tone'] = 'info') {
  if (tone === 'error') {
    errorLog.push({ time: new Date(), text })
    if (errorLog.length > 1000) errorLog.shift()
  }
  const t = { id: ++toastId, text, tone }
  toasts = [...toasts, t]
  toastListeners.forEach((l) => l())
  setTimeout(() => dismissToast(t.id), tone === 'error' ? 5000 : 3000)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  toastListeners.forEach((l) => l())
}
