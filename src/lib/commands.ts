import * as A from './actions'
import { errorText } from './bridge'
import { changeDirectory, disconnect, newProject, reconnect } from './connection'
import { prompt, toast } from './dialogs'
import { pane } from './panes'
import { addThemeRepo, loadUserThemes, removeThemeRepo, updateSettings, updateThemeRepos } from './settings'
import * as S from './store'

export type Command = {
  name: string
  desc: string
  aliases?: string[]
  keys?: string
  run: (args: string) => void | Promise<void>
}

export function keyLabel(keys: string): string {
  if (S.isMac()) return '⌘' + keys.replace('Shift+', '⇧')
  return 'Ctrl+' + keys
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
  { name: 'Explorer', desc: 'Show or hide the Explorer sidebar', keys: 'E', run: () => A.openExplorer() },
  { name: 'WordWrap', desc: 'Wrap long lines in editors (Option+Z)', aliases: ['wrap', 'ToggleWordWrap'], run: () => A.toggleWordWrap() },
  { name: 'Sidebar', desc: 'Show or hide the sidebar', keys: 'B', aliases: ['ToggleSidebar'], run: () => A.toggleSidebar() },
  {
    name: 'Sql',
    desc: 'Query a database in a new tab (PostgreSQL, MySQL, SQL Server, SQLite)',
    keys: 'D',
    aliases: ['SQL', 'Database', 'DB', 'sql', 'db'],
    run: (args) => A.openSql(args.trim() || undefined),
  },
  {
    name: 'Search',
    desc: 'Show or hide the Search sidebar',
    keys: 'F',
    aliases: ['Find'],
    run: (args) => (args.trim() ? A.openSearch('text', args.trim()) : A.toggleSearch()),
  },
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
  { name: 'Git', desc: 'Show or hide the Git sidebar', keys: 'G', aliases: ['SourceControl'], run: () => A.openScm() },
  { name: 'Terminal', desc: 'Terminal in new tab', keys: 'T', aliases: ['terminal', 'term'], run: () => A.openTerminal() },
  { name: 'Split', desc: 'Terminal in horizontal split', keys: '\\', aliases: ['split', 'sp'], run: () => A.splitTerminal('below') },
  {
    name: 'VSplit',
    desc: 'Terminal in vertical split',
    keys: 'Shift+\\',
    aliases: ['vsplit', 'vs'],
    run: () => A.splitTerminal('right'),
  },
  { name: 'New', desc: 'New tab', keys: 'N', aliases: ['tabnew', 'enew', 'new'], run: () => A.newTab() },
  {
    name: 'Edit',
    desc: 'Open a file by its path',
    aliases: ['e', 'edit', 'tabedit', 'tabe', 'Open'],
    run: async (args) => {
      const path = args.trim() ? A.resolvePath(args.trim()) : await A.askPath('Open file')
      if (path) A.openFile(path)
    },
  },
  { name: 'Close', desc: 'Close window', keys: 'W', aliases: ['q', 'quit', 'close', 'clo', 'tabclose'], run: () => A.closeFocused() },
  { name: 'Save', desc: 'Save', keys: 'S', aliases: ['w', 'write'], run: () => A.save() },
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
  { name: 'NextTab', desc: 'Next tab', keys: 'L', aliases: ['tabnext', 'tabn'], run: () => A.cycleTab(1) },
  { name: 'PreviousTab', desc: 'Previous tab', keys: 'H', aliases: ['tabprevious', 'tabp'], run: () => A.cycleTab(-1) },
  { name: 'NextPane', desc: 'Move to the next pane (a part of the tab, or a split)', keys: 'J', run: () => A.cyclePane(1) },
  { name: 'PreviousPane', desc: 'Move to the previous pane (a part of the tab, or a split)', keys: 'K', run: () => A.cyclePane(-1) },
  { name: 'Welcome', desc: 'Show the welcome screen', aliases: ['intro'], run: () => A.openWelcome() },
  { name: 'MaxColumns', desc: 'Set the width that files and terminals are centered at', run: setNumber('Max columns', 'maxColumns', 40, 400) },
  { name: 'FontSize', desc: 'Set the font size of files and terminals', run: setNumber('Font size', 'fontSize', 8, 40) },
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
