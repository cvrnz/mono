import { VimMode } from 'monaco-vim'
import * as A from './actions'
import { copyText } from './bridge'
import { monaco } from './monaco'
import { pane } from './panes'
import * as S from './store'

type ExParams = { args?: string[] }
type VimApi = {
  defineAction(name: string, fn: () => void): void
  mapCommand(keys: string, type: string, name: string, args: object, extra: object): void
  defineEx(name: string, prefix: string, fn: (cm: unknown, params: ExParams) => void): void
  handleEx(cm: unknown, input: string): void
}

export const Vim = (VimMode as unknown as { Vim: VimApi }).Vim

function activePane() {
  const tab = S.activeTab()
  return tab ? pane(S.focusedPane(tab)) : undefined
}

// Vim maps Ctrl+C to Esc, which off macOS left no key that copies. Copy the selection first;
// Vim still gets the key and leaves Visual mode. Register before initVimMode so this runs first.
export function copyOnCtrlC(editor: monaco.editor.IStandaloneCodeEditor) {
  return editor.onKeyDown((e) => {
    if (S.isMac() || !e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.keyCode !== monaco.KeyCode.KeyC) return
    const sel = editor.getSelection()
    const model = editor.getModel()
    if (sel && model && !sel.isEmpty()) copyText(model.getValueInRange(sel))
  })
}

let ready = false

export function setupVim() {
  if (ready) return
  ready = true
  const ex = (name: string, prefix: string, fn: (args: string) => unknown) =>
    Vim.defineEx(name, prefix, (_cm, params) => {
      fn((params.args ?? []).join(' ').trim())
    })
  const saveTo = async (args: string) => {
    const p = activePane()
    if (!p?.save) return false
    return args ? p.save(true, A.resolvePath(args)) : p.save()
  }
  ex('write', 'w', saveTo)
  ex('saveas', 'sav', (args) => activePane()?.save?.(true, args ? A.resolvePath(args) : undefined))
  ex('wall', 'wa', () => A.saveAll())
  ex('quit', 'q', () => A.closeFocused())
  ex('qall', 'qa', () => A.quit())
  ex('wq', 'wq', async (args) => {
    if (await saveTo(args)) await A.closeFocused()
  })
  ex('xit', 'x', async (args) => {
    const tab = S.activeTab()
    if (tab?.kind === 'file' && !tab.dirty && !args) return A.closeFocused()
    if (await saveTo(args)) await A.closeFocused()
  })
  ex('edit', 'e', (args) => (args ? A.openFile(A.resolvePath(args)) : undefined))
  ex('tabedit', 'tabe', (args) => (args ? A.openFile(A.resolvePath(args)) : A.newTab()))
  ex('tabnew', 'tabnew', (args) => (args ? A.openFile(A.resolvePath(args)) : A.newTab()))
  ex('tabnext', 'tabn', () => A.cycleTab(1))
  ex('tabprevious', 'tabp', () => A.cycleTab(-1))
  ex('terminal', 'ter', () => A.openTerminal())
}
