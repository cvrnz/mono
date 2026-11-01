import * as A from './actions'
import { isDialogOpen } from './dialogs'
import { pane } from './panes'
import * as S from './store'

type Binding = { code: string; shift?: boolean; run: () => void; project?: boolean }

const bindings: Binding[] = [
  { code: 'KeyW', run: () => A.closeFocused() },
  { code: 'KeyS', run: () => A.save() },
  { code: 'KeyN', run: () => A.newTab() },
  { code: 'KeyP', run: () => openPalette() },
  { code: 'KeyF', run: () => A.toggleSearch() },
  { code: 'KeyG', run: () => A.openScm() },
  { code: 'KeyE', run: () => A.openExplorer() },
  { code: 'KeyT', run: () => A.openTerminal() },
  { code: 'KeyD', run: () => A.openSql() },
  { code: 'Backslash', run: () => A.splitTerminal('below') },
  { code: 'Backslash', shift: true, run: () => A.splitTerminal('right') },
  { code: 'KeyH', run: () => A.cycleTab(-1) },
  { code: 'KeyL', run: () => A.cycleTab(1) },
  { code: 'KeyJ', run: () => A.cyclePane(1) },
  { code: 'KeyK', run: () => A.cyclePane(-1) },
  ...Array.from({ length: 9 }, (_, i): Binding => ({ code: `Digit${i + 1}`, run: () => A.switchToProject(i), project: true })),
]

function openPalette() {
  const s = S.get()
  S.set({ palette: s.palette ? null : { mode: 'commands' }, previewTheme: null })
  if (s.palette) A.focusActive()
}

function inTerminal(target: EventTarget | null) {
  if (!(target instanceof Element && target.closest('.xterm'))) return false
  const tab = S.activeTab()
  return pane(tab && S.focusedPane(tab))?.shellInput?.() ?? true
}

function onKeyDown(e: KeyboardEvent) {
  if (isDialogOpen() || e.altKey) return
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const s = S.get()
    if (s.palette) {
      e.preventDefault()
      e.stopPropagation()
      S.set({ palette: null, previewTheme: null })
      A.focusActive()
    }
    return
  }
  const mac = S.isMac()
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!mod) return
  const connected = S.isConnected(S.get().conn)
  const switching = S.get().projects.length > 1
  if (!connected && !switching) return

  let b = bindings.find((x) => x.code === e.code && Boolean(x.shift) === e.shiftKey)
  if (!b && !mac && e.shiftKey && !inTerminal(e.target)) b = bindings.find((x) => x.code === e.code && !x.shift)
  if (!b || (!connected && !b.project)) return
  e.preventDefault()
  e.stopPropagation()
  b.run()
}

export function installKeys(): () => void {
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
