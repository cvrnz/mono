import { isInside } from './paths'
import { updateSettings } from './settings'
import * as S from './store'

/** The folder a project has open, told apart by where it lives (this computer or a container). */
function folderKey(project: string, s: S.State = S.get()): string | null {
  const c = s.projects.find((p) => p.id === project)?.conn
  if (!c || !S.isConnected(c)) return null
  const where = c.target.kind === 'docker' ? `docker:${c.target.container}` : 'local'
  return `${where}:${c.hello.root}`
}

/** Whether git may run in a project: a repo's own settings can make git run programs, so a folder has to be trusted first. */
export function isTrusted(project: string, s: S.State = S.get()): boolean {
  const key = folderKey(project, s)
  if (!key) return false
  return (s.settings.trustedFolders ?? []).some((t) => isInside(key, t))
}

export function useTrusted(project: string): boolean {
  return S.useStore((s) => isTrusted(project, s))
}

export class UntrustedError extends Error {
  constructor() {
    super("this folder isn't trusted, so git doesn't run in it")
  }
}

export function trustFolder(project: string) {
  const key = folderKey(project)
  if (!key) return
  void updateSettings({ trustedFolders: [...(S.get().settings.trustedFolders ?? []).filter((t) => !isInside(t, key)), key] })
}
