import * as A from './actions'
import { comboOf, commandForKeys, hasModifier } from './commands'
import { isDialogOpen } from './dialogs'
import { pane } from './panes'
import * as S from './store'

let capturing = false
/** While a new shortcut is being picked, key presses go to the picker instead of running commands. */
export function setCapturing(on: boolean) {
  capturing = on
}

function inTerminal(target: EventTarget | null) {
  if (!(target instanceof Element && target.closest('.xterm'))) return false
  const tab = S.activeTab()
  return pane(tab && S.focusedPane(tab))?.shellInput?.() ?? true
}

function onKeyDown(e: KeyboardEvent) {
  if (isDialogOpen() || capturing) return
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
    if (S.get().palette) {
      e.preventDefault()
      e.stopPropagation()
      S.set({ palette: null, previewTheme: null, previewIcons: null })
      A.focusActive()
    }
    return
  }
  const combo = comboOf(e)
  if (!combo || !hasModifier(combo)) return
  const connected = S.isConnected(S.get().conn)
  const switching = S.get().projects.length > 1
  if (!connected && !switching) return

  let c = commandForKeys(combo)
  // Ctrl+Shift+key works like Ctrl+key outside terminals, where Ctrl+key belongs to the shell.
  if (!c && !S.isMac() && e.shiftKey && !inTerminal(e.target)) c = commandForKeys(combo.replace('+Shift', ''))
  if (!c || (!connected && !c.project)) return
  e.preventDefault()
  e.stopPropagation()
  c.run('')
}

export function installKeys(): () => void {
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
