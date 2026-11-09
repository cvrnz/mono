import * as A from './actions'
import { errorText } from './bridge'
import { changeDirectory, disconnect, newProject, reconnect } from './connection'
import { errorLog, prompt, toast } from './dialogs'
import { pane } from './panes'
import { addThemeRepo, loadUserThemes, removeThemeRepo, updateSettings, updateThemeRepos, zoom } from './settings'
import * as S from './store'

export type Command = {
  name: string
  desc: string
  aliases?: string[]
  /** The default shortcut, like `Mod+Shift+F` (Mod is ⌘ on macOS and Ctrl elsewhere). */
  keys?: string
  /** Kept out of the command list, but its shortcut can still be changed. */
  hidden?: boolean
  /** Works before this project is connected. */
  project?: boolean
  /** Works on the connect screen too. */
  always?: boolean
  run: (args: string) => void | Promise<void>
}

const macSymbols: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '◆' }

export function keyLabel(keys: string): string {
  if (!keys) return ''
  const parts = keys.split(/\+(?=.)/)
  if (S.isMac()) return parts.map((k) => macSymbols[k] ?? k).join('')
  return parts.map((k) => (k === 'Mod' ? 'Ctrl' : k)).join('+')
}

export function keysOf(c: Command): string {
  return S.get().settings.keys?.[c.name] ?? c.keys ?? ''
}

/** The label of a command's shortcut, or '' when it has none. */
export function shortcut(name: string): string {
  const c = commands.find((x) => x.name === name)
  return c ? keyLabel(keysOf(c)) : ''
}

const codeNames: Record<string, string> = {
  Backquote: '`', Backslash: '\\', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown',
}

/** The shortcut a key press makes, like `Mod+Shift+F`, or null for a modifier on its own. */
export function comboOf(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const code = e.code
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d+$/.test(code) ? code : codeNames[code]
  if (!key) return null
  const mac = S.isMac()
  const parts: string[] = []
  if (mac ? e.metaKey : e.ctrlKey) parts.push('Mod')
  if (mac && e.ctrlKey) parts.push('Ctrl')
  if (!mac && e.metaKey) parts.push('Meta')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  return [...parts, key].join('+')
}

/** Whether a shortcut has a modifier other than Shift, so it can't be typed text. */
export function hasModifier(keys: string): boolean {
  return /^(Mod|Ctrl|Alt|Meta)\+/.test(keys)
}

export function commandForKeys(keys: string): Command | undefined {
  return commands.find((c) => keysOf(c) === keys)
}

/** Gives a command a new shortcut, taking it off any command that had it. Returns the commands it was taken from. */
export function setKeys(name: string, keys: string | null): string[] {
  const c = commands.find((x) => x.name === name)
  if (!c) return []
  const next = { ...S.get().settings.keys }
  const taken: string[] = []
  if (keys) {
    for (const o of commands) {
      if (o !== c && keysOf(o) === keys) {
        next[o.name] = ''
        taken.push(o.name)
      }
    }
  }
  const value = keys ?? c.keys ?? ''
  if (value === (c.keys ?? '')) delete next[name]
  else next[name] = value
  updateSettings({ keys: next })
  return taken
}

function setNumber(name: string, key: 'maxColumns' | 'fontSize' | 'gitDepth', min: number, max: number) {
  return async (args: string) => {
    let text = args.trim()
    if (!text) {
      const v = await prompt(name, String(S.get().settings[key]))
      if (v === null) return
      text = v.trim()
    }
    const n = Number(text)
    if (!Number.isInteger(n) || n < min || n > max) {
      toast(`${name} must be a whole number from ${min} to ${max}`, 'error')
      return
    }
    updateSettings({ [key]: n })
  }
}

async function themeRepo(args: string, title: string, message?: string) {
  const text = args.trim() || ((await prompt(title, '', message)) ?? '').trim()
  return text || null
}

function reportError(e: unknown) {
  toast(errorText(e), 'error')
}

export const commands: Command[] = [
  { name: 'Themes', desc: 'Pick a theme', run: () => loadUserThemes().then(() => S.set({ palette: { mode: 'themes' } })) },
  { name: 'IconPacks', desc: 'Pick the file icons, with a preview', aliases: ['Icons', 'FileIcons'], run: () => S.set({ palette: { mode: 'icons' } }) },
  {
    name: 'AddTheme',
    desc: 'Download a theme from GitHub (owner/repo)',
    aliases: ['InstallTheme'],
    run: async (args) => {
      const repo = await themeRepo(args, 'Add theme', 'A GitHub repo with theme .json files, like cvrnz/monomyth-dark-theme')
      if (repo) await addThemeRepo(repo).catch(reportError)
    },
  },
  {
    name: 'RemoveTheme',
    desc: 'Delete a downloaded theme',
    aliases: ['DeleteTheme', 'UninstallTheme'],
    run: async (args) => {
      const repos = S.get().settings.themeRepos
      if (!repos.length) {
        toast('No downloaded themes')
        return
      }
      const repo = await themeRepo(args, 'Remove theme', repos.join(', '))
      if (!repo) return
      if (!repos.includes(repo)) {
        toast(`${repo} isn't one of your themes (${repos.join(', ')})`, 'error')
        return
      }
      await removeThemeRepo(repo).catch(reportError)
    },
  },
  { name: 'UpdateThemes', desc: 'Download the latest version of every theme', run: () => updateThemeRepos() },
  {
    name: 'ToggleLineNumbers',
    desc: 'Show or hide line numbers in files and diffs',
    run: () => updateSettings({ lineNumbers: !S.get().settings.lineNumbers }),
  },
  {
    name: 'ToggleVim',
    desc: 'Turn Vim keybindings on or off',
    run: () => {
      const vim = !S.get().settings.vim
      updateSettings({ vim })
      toast(vim ? 'Vim keybindings on' : 'Vim keybindings off')
    },
  },
  {
    name: 'ChangeDirectory',
    desc: 'Work in a different folder (where terminals open and git looks for repos)',
    aliases: ['cd', 'ChangeDir'],
    run: (args) => changeDirectory(args),
  },
  {
    name: 'TabIcons',
    desc: 'Show the Explorer, Git and Search tabs as icons or as text',
    aliases: ['ToggleTabIcons'],
    run: () => {
      const tabIcons = !S.get().settings.tabIcons
      updateSettings({ tabIcons })
      toast(tabIcons ? 'Explorer, Git and Search tabs show icons' : 'Explorer, Git and Search tabs show text')
    },
  },
  {
    name: 'GitDepth',
    desc: 'How many folders deep the git tab looks for repos (default 4)',
    run: setNumber('Git depth', 'gitDepth', 0, 12),
  },
  {
    name: 'Errors',
    desc: 'Show every error from this session in a new tab',
    aliases: ['ErrorLog', 'ErrorHistory'],
    run: () => {
      if (!errorLog.length) {
        toast('No errors so far')
        return
      }
      const pad = (n: number) => String(n).padStart(2, '0')
      const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      A.openText('Errors', errorLog.map((e) => `[${stamp(e.time)}] ${e.text}`).join('\n') + '\n')
    },
  },
  {
    name: 'Preview',
    desc: 'Show or hide the rendered view beside Markdown and SVG files',
    aliases: ['TogglePreview', 'MarkdownPreview'],
    run: () => {
      const preview = S.get().settings.preview === false
      updateSettings({ preview })
      toast(preview ? 'Previews on' : 'Previews off')
    },
  },
  { name: 'Explorer', desc: 'Show or hide the Explorer sidebar', keys: 'Mod+E', run: () => A.openExplorer() },
  { name: 'RefreshExplorer', desc: 'Read the folders shown in the Explorer again', aliases: ['ReloadExplorer'], run: () => A.refreshExplorer() },
  { name: 'WordWrap', desc: 'Wrap long lines in editors', keys: 'Alt+Z', aliases: ['wrap', 'ToggleWordWrap'], run: () => A.toggleWordWrap() },
  { name: 'Sidebar', desc: 'Show or hide the sidebar', keys: 'Mod+B', aliases: ['ToggleSidebar'], run: () => A.toggleSidebar() },
  {
    name: 'Sql',
    desc: 'Query a database in a new tab (PostgreSQL, MySQL, SQL Server, SQLite)',
    keys: 'Mod+D',
    aliases: ['SQL', 'Database', 'DB', 'sql', 'db'],
    run: (args) => A.openSql(args.trim() || undefined),
  },
  {
    name: 'Search',
    desc: 'Show or hide the Search sidebar',
    keys: 'Mod+Shift+F',
    aliases: ['SearchFiles'],
    run: (args) => (args.trim() ? A.openSearch('text', args.trim()) : A.toggleSearch()),
  },
  { name: 'Find', desc: 'Find in the file or terminal in front', keys: 'Mod+F', run: () => A.findInPane() },
  {
    name: 'Grep',
    desc: 'Search text in files',
    aliases: ['SearchText'],
    run: (args) => A.openSearch('text', args.trim()),
  },
  {
    name: 'FindFile',
    desc: 'Search file names',
    aliases: ['Files', 'SearchFiles'],
    run: (args) => A.openSearch('files', args.trim()),
  },
  { name: 'Git', desc: 'Show or hide the Git sidebar', keys: 'Mod+G', aliases: ['SourceControl'], run: () => A.openScm() },
  { name: 'GitLog', desc: 'Show or hide the log in the Git sidebar', aliases: ['Log', 'ToggleLog'], run: () => A.toggleGitLog() },
  { name: 'Run', desc: 'Show or hide the Run sidebar, with your run configurations', keys: 'Mod+Shift+R', aliases: ['RunConfigurations', 'Tasks'], run: () => A.toggleRun() },
  { name: 'Terminal', desc: 'Terminal in new tab', keys: 'Mod+T', aliases: ['terminal', 'term'], run: () => A.openTerminal() },
  { name: 'Split', desc: 'Terminal in horizontal split', keys: 'Mod+\\', aliases: ['split', 'sp'], run: () => A.splitTerminal('below') },
  {
    name: 'VSplit',
    desc: 'Terminal in vertical split',
    keys: 'Mod+Shift+\\',
    aliases: ['vsplit', 'vs'],
    run: () => A.splitTerminal('right'),
  },
  { name: 'New', desc: 'New tab', keys: 'Mod+N', aliases: ['tabnew', 'enew', 'new'], run: () => A.newTab() },
  {
    name: 'Edit',
    desc: 'Open a file by its path',
    aliases: ['e', 'edit', 'tabedit', 'tabe', 'Open'],
    run: async (args) => {
      const path = args.trim() ? A.resolvePath(args.trim()) : await A.askPath('Open file')
      if (path) A.openFile(path)
    },
  },
  { name: 'Close', desc: 'Close window', keys: 'Mod+W', aliases: ['q', 'quit', 'close', 'clo', 'tabclose'], run: () => A.closeFocused() },
  { name: 'Save', desc: 'Save', keys: 'Mod+S', aliases: ['w', 'write'], run: () => A.save() },
  { name: 'SaveAs', desc: 'Save as a new file', aliases: ['saveas', 'sav'], run: () => A.save(true) },
  {
    name: 'SaveAll',
    desc: 'Save every changed file',
    aliases: ['wall', 'wa'],
    run: async () => {
      await A.saveAll()
    },
  },
  {
    name: 'SaveClose',
    desc: 'Save, then close',
    aliases: ['wq', 'x', 'xit'],
    run: async () => {
      const tab = S.activeTab()
      if (tab?.kind === 'file' && tab.dirty && !(await pane(tab.id)?.save?.())) return
      await A.closeFocused()
    },
  },
  { name: 'NextTab', desc: 'Next tab', keys: 'Mod+L', aliases: ['tabnext', 'tabn'], run: () => A.cycleTab(1) },
  { name: 'PreviousTab', desc: 'Previous tab', keys: 'Mod+H', aliases: ['tabprevious', 'tabp'], run: () => A.cycleTab(-1) },
  { name: 'NextPane', desc: 'Move to the next pane (a part of the tab, or a split)', keys: 'Mod+J', run: () => A.cyclePane(1) },
  { name: 'PreviousPane', desc: 'Move to the previous pane (a part of the tab, or a split)', keys: 'Mod+K', run: () => A.cyclePane(-1) },
  { name: 'Welcome', desc: 'Show the welcome screen', aliases: ['intro'], run: () => A.openWelcome() },
  { name: 'MaxColumns', desc: 'Set the width that files and terminals are centered at', run: setNumber('Max columns', 'maxColumns', 40, 400) },
  { name: 'FontSize', desc: 'Set the font size of files and terminals', run: setNumber('Font size', 'fontSize', 8, 40) },
  { name: 'Fonts', desc: 'Pick the font of files and terminals, with a preview', aliases: ['Font', 'FontFamily'], run: () => S.set({ palette: { mode: 'fonts' } }) },
  { name: 'ZoomIn', desc: 'Make everything in the window bigger', keys: 'Mod+=', always: true, run: () => zoom(1) },
  { name: 'ZoomOut', desc: 'Make everything in the window smaller', keys: 'Mod+-', always: true, run: () => zoom(-1) },
  { name: 'ResetZoom', desc: 'Put the window back to its normal size', keys: 'Mod+0', aliases: ['ActualSize'], always: true, run: () => zoom(0) },
  {
    name: 'Reconnect',
    desc: 'Reconnect to the container',
    run: () => {
      const c = S.get().conn
      if (c.state === 'lost') reconnect()
      else if (c.state === 'connected') toast('Already connected')
    },
  },
  {
    name: 'Restart',
    desc: 'Restart the connection to the container (open files and unsaved changes stay)',
    run: async () => {
      const c = S.get().conn
      if (c.state === 'connected') S.set({ conn: { state: 'lost', hello: c.hello, target: c.target, error: 'Restarting…' } })
      await reconnect()
    },
  },
  { name: 'NewProject', desc: 'Open another container or folder alongside this one', aliases: ['project'], run: () => newProject() },
  { name: 'Disconnect', desc: 'Close this project and its connection', aliases: ['CloseProject'], run: () => disconnect() },
  {
    name: 'DockerPath',
    desc: 'Set where the docker command is (empty to find it on PATH)',
    run: async (args) => {
      const v = args.trim() || (await prompt('Path to docker', S.get().settings.dockerPath ?? '', 'Leave empty to find it on PATH'))
      if (v !== null) updateSettings({ dockerPath: v.trim() || undefined })
    },
  },
  {
    name: 'Keys',
    desc: 'Change keyboard shortcuts',
    aliases: ['Shortcuts', 'KeyboardShortcuts', 'Keybindings'],
    run: () => S.set({ palette: { mode: 'keys' } }),
  },
  {
    name: 'ResetKeys',
    desc: 'Put every keyboard shortcut back to its default',
    aliases: ['ResetShortcuts'],
    run: () => {
      updateSettings({ keys: undefined })
      toast('Keyboard shortcuts reset')
    },
  },
  { name: 'Palette', desc: 'Open or close the command palette', keys: 'Mod+P', hidden: true, run: () => A.togglePalette() },
  { name: 'NextProject', desc: 'Switch to the next project', keys: 'Mod+`', aliases: ['NextEnvironment'], project: true, run: () => A.cycleProject(1) },
  { name: 'PreviousProject', desc: 'Switch to the previous project', keys: 'Mod+Shift+`', aliases: ['PreviousEnvironment'], project: true, run: () => A.cycleProject(-1) },
  ...Array.from({ length: 9 }, (_, i): Command => ({
    name: `Project${i + 1}`,
    desc: `Switch to project ${i + 1}`,
    keys: `Mod+${i + 1}`,
    hidden: true,
    project: true,
    run: () => A.switchToProject(i),
  })),
  { name: 'Quit', desc: 'Quit the app', aliases: ['qa', 'qall', 'quitall'], run: () => A.quit() },
]

export function resolve(typed: string): { command: Command; args: string } | null {
  const m = typed.trim().match(/^(\S+)(?:\s+(.*))?$/)
  if (!m) return null
  const [, word, args = ''] = m
  const lower = word.toLowerCase()
  for (const c of commands) {
    if (c.name.toLowerCase() === lower || c.aliases?.includes(word)) return { command: c, args }
  }
  return null
}

const exCommands = new Set([
  's', 'substitute', 'g', 'global', 'v', 'vglobal', 'noh', 'nohlsearch', 'set', 'se', 'sort', 'sor',
  'd', 'delete', 'y', 'yank', 'm', 'move', 't', 'co', 'copy', 'normal', 'norm', 'undo', 'u', 'redo', 'red',
  'map', 'nmap', 'imap', 'vmap', 'noremap', 'nnoremap', 'inoremap', 'vnoremap', 'unmap', 'marks', 'reg', 'registers',
  'j', 'join', 'r', 'read', 'delm', 'delmarks', 'let',
])

export function isExLine(typed: string): boolean {
  const t = typed.trim()
  if (!t) return false
  if (/^[\d%'.$,+\-/?<>&~]/.test(t)) return true
  const word = t.match(/^[a-zA-Z]+/)?.[0]
  return Boolean(word && exCommands.has(word))
}

export function vimPane() {
  const tab = S.activeTab()
  if (!tab || tab.kind !== 'file' || !S.get().settings.vim) return undefined
  const p = pane(S.focusedPane(tab))
  return p?.vimEx ? p : undefined
}

export function isComplete(typed: string): boolean {
  return Boolean(resolve(typed)) || (Boolean(vimPane()) && isExLine(typed))
}

export async function runLine(typed: string) {
  const t = typed.trim()
  if (!t) return
  const hit = resolve(t)
  if (hit) {
    await hit.command.run(hit.args)
    return
  }
  const vim = vimPane()
  if (vim && isExLine(t)) {
    vim.focus()
    vim.vimEx!(t)
    return
  }
  toast(`Not a command: ${t}`, 'error')
}
