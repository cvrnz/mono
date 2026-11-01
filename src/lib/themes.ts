import type { ITheme } from '@xterm/xterm'
import type * as Monaco from 'monaco-editor'

export type Palette = {
  name: string
  bg: string
  dark: string
  raised: string
  selection: string
  fg: string
  dim: string
  red: string
  green: string
  yellow: string
  orange: string
  blue: string
  purple: string
  cyan: string
}

export const themes: Palette[] = [
  { name: 'onedark', bg: '#282c34', dark: '#21252b', raised: '#31353f', selection: '#3e4452', fg: '#abb2bf', dim: '#5c6370', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', orange: '#d19a66', blue: '#61afef', purple: '#c678dd', cyan: '#56b6c2' },
  { name: 'catppuccin', bg: '#1e1e2e', dark: '#181825', raised: '#2a2b3c', selection: '#45475a', fg: '#cdd6f4', dim: '#6c7086', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', orange: '#fab387', blue: '#89b4fa', purple: '#cba6f7', cyan: '#94e2d5' },
  { name: 'tokyonight', bg: '#1a1b26', dark: '#16161e', raised: '#292e42', selection: '#283457', fg: '#c0caf5', dim: '#565f89', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', orange: '#ff9e64', blue: '#7aa2f7', purple: '#bb9af7', cyan: '#7dcfff' },
  { name: 'rose-pine', bg: '#191724', dark: '#1f1d2e', raised: '#21202e', selection: '#403d52', fg: '#e0def4', dim: '#6e6a86', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', orange: '#ebbcba', blue: '#9ccfd8', purple: '#c4a7e7', cyan: '#9ccfd8' },
  { name: 'kanagawa', bg: '#1f1f28', dark: '#16161d', raised: '#2a2a37', selection: '#2d4f67', fg: '#dcd7ba', dim: '#727169', red: '#e46876', green: '#98bb6c', yellow: '#e6c384', orange: '#ffa066', blue: '#7e9cd8', purple: '#957fb8', cyan: '#7fb4ca' },
  { name: 'gruvbox', bg: '#282828', dark: '#1d2021', raised: '#3c3836', selection: '#504945', fg: '#ebdbb2', dim: '#928374', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', orange: '#fe8019', blue: '#83a598', purple: '#d3869b', cyan: '#8ec07c' },
  { name: 'nightfox', bg: '#192330', dark: '#131a24', raised: '#212e3f', selection: '#2b3b51', fg: '#cdcecf', dim: '#738091', red: '#c94f6d', green: '#81b29a', yellow: '#dbc074', orange: '#f4a261', blue: '#719cd6', purple: '#9d79d6', cyan: '#63cdcf' },
  { name: 'everforest', bg: '#2d353b', dark: '#232a2e', raised: '#343f44', selection: '#475258', fg: '#d3c6aa', dim: '#859289', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', orange: '#e69875', blue: '#7fbbb3', purple: '#d699b6', cyan: '#83c092' },
  { name: 'onedark-vivid', bg: '#282c34', dark: '#21252b', raised: '#31353f', selection: '#3e4452', fg: '#bbbbbb', dim: '#5c6370', red: '#ef596f', green: '#89ca78', yellow: '#e5c07b', orange: '#d19a66', blue: '#61afef', purple: '#d55fde', cyan: '#2bbac5' },
  { name: 'onedark-darker', bg: '#1f2329', dark: '#181b20', raised: '#282c34', selection: '#30363f', fg: '#a0a8b7', dim: '#535965', red: '#e55561', green: '#8ebd6b', yellow: '#e2b86b', orange: '#cc9057', blue: '#4fa6ed', purple: '#bf68d9', cyan: '#48b0bd' },
  { name: 'dracula', bg: '#282a36', dark: '#21222c', raised: '#343746', selection: '#44475a', fg: '#f8f8f2', dim: '#6272a4', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', orange: '#ffb86c', blue: '#bd93f9', purple: '#ff79c6', cyan: '#8be9fd' },
  { name: 'monokai', bg: '#272822', dark: '#1e1f1c', raised: '#3e3d32', selection: '#49483e', fg: '#f8f8f2', dim: '#75715e', red: '#f92672', green: '#a6e22e', yellow: '#e6db74', orange: '#fd971f', blue: '#66d9ef', purple: '#ae81ff', cyan: '#a1efe4' },
  { name: 'monokai-pro', bg: '#2d2a2e', dark: '#221f22', raised: '#383539', selection: '#403e41', fg: '#fcfcfa', dim: '#727072', red: '#ff6188', green: '#a9dc76', yellow: '#ffd866', orange: '#fc9867', blue: '#78dce8', purple: '#ab9df2', cyan: '#78dce8' },
  { name: 'nord', bg: '#2e3440', dark: '#272c36', raised: '#3b4252', selection: '#434c5e', fg: '#d8dee9', dim: '#616e88', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', orange: '#d08770', blue: '#81a1c1', purple: '#b48ead', cyan: '#88c0d0' },
  { name: 'solarized-dark', bg: '#002b36', dark: '#00212b', raised: '#073642', selection: '#0f4a58', fg: '#839496', dim: '#586e75', red: '#dc322f', green: '#859900', yellow: '#b58900', orange: '#cb4b16', blue: '#268bd2', purple: '#6c71c4', cyan: '#2aa198' },
  { name: 'github-dark', bg: '#0d1117', dark: '#010409', raised: '#161b22', selection: '#264f78', fg: '#c9d1d9', dim: '#8b949e', red: '#ff7b72', green: '#7ee787', yellow: '#d29922', orange: '#ffa657', blue: '#79c0ff', purple: '#d2a8ff', cyan: '#a5d6ff' },
  { name: 'github-dark-dimmed', bg: '#22272e', dark: '#1c2128', raised: '#2d333b', selection: '#3e4b5e', fg: '#adbac7', dim: '#768390', red: '#f47067', green: '#8ddb8c', yellow: '#c69026', orange: '#f69d50', blue: '#6cb6ff', purple: '#dcbdfb', cyan: '#96d0ff' },
  { name: 'vscode-dark', bg: '#1e1e1e', dark: '#181818', raised: '#2a2d2e', selection: '#264f78', fg: '#d4d4d4', dim: '#808080', red: '#f44747', green: '#6a9955', yellow: '#dcdcaa', orange: '#ce9178', blue: '#569cd6', purple: '#c586c0', cyan: '#4ec9b0' },
  { name: 'darcula', bg: '#2b2b2b', dark: '#232525', raised: '#323232', selection: '#214283', fg: '#a9b7c6', dim: '#808080', red: '#ff6b68', green: '#6a8759', yellow: '#ffc66d', orange: '#cc7832', blue: '#6897bb', purple: '#9876aa', cyan: '#299999' },
  { name: 'material-palenight', bg: '#292d3e', dark: '#1b1e2b', raised: '#32374d', selection: '#444267', fg: '#a6accd', dim: '#676e95', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b', orange: '#f78c6c', blue: '#82aaff', purple: '#c792ea', cyan: '#89ddff' },
  { name: 'material-ocean', bg: '#0f111a', dark: '#090b10', raised: '#1a1c25', selection: '#292d3e', fg: '#8f93a2', dim: '#464b5d', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b', orange: '#f78c6c', blue: '#82aaff', purple: '#c792ea', cyan: '#89ddff' },
  { name: 'material-darker', bg: '#212121', dark: '#1a1a1a', raised: '#2c2c2c', selection: '#404040', fg: '#eeffff', dim: '#616161', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b', orange: '#f78c6c', blue: '#82aaff', purple: '#c792ea', cyan: '#89ddff' },
  { name: 'ayu-dark', bg: '#0b0e14', dark: '#05070a', raised: '#131721', selection: '#273747', fg: '#bfbdb6', dim: '#565b66', red: '#f07178', green: '#aad94c', yellow: '#e6b450', orange: '#ff8f40', blue: '#59c2ff', purple: '#d2a6ff', cyan: '#95e6cb' },
  { name: 'ayu-mirage', bg: '#1f2430', dark: '#1a1f29', raised: '#242936', selection: '#33415e', fg: '#cccac2', dim: '#707a8c', red: '#f28779', green: '#d5ff80', yellow: '#ffd173', orange: '#ffad66', blue: '#73d0ff', purple: '#dfbfff', cyan: '#95e6cb' },
  { name: 'night-owl', bg: '#011627', dark: '#010e1a', raised: '#0b2942', selection: '#1d3b53', fg: '#d6deeb', dim: '#637777', red: '#ef5350', green: '#addb67', yellow: '#ecc48d', orange: '#f78c6c', blue: '#82aaff', purple: '#c792ea', cyan: '#7fdbca' },
  { name: 'cobalt2', bg: '#193549', dark: '#122738', raised: '#1f4662', selection: '#0050a4', fg: '#e1efff', dim: '#0088ff', red: '#ff628c', green: '#3ad900', yellow: '#ffc600', orange: '#ff9d00', blue: '#9effff', purple: '#fb94ff', cyan: '#80fcff' },
  { name: 'horizon', bg: '#1c1e26', dark: '#16161c', raised: '#232530', selection: '#2e303e', fg: '#e0e0e0', dim: '#6c6f93', red: '#e95678', green: '#29d398', yellow: '#fab795', orange: '#f09483', blue: '#26bbd9', purple: '#ee64ac', cyan: '#59e1e3' },
  { name: 'synthwave-84', bg: '#262335', dark: '#171520', raised: '#2a2139', selection: '#463465', fg: '#f0eff1', dim: '#848bbd', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', orange: '#f97e72', blue: '#2ee2fa', purple: '#ff7edb', cyan: '#03edf9' },
  { name: 'andromeda', bg: '#23262e', dark: '#1b1d23', raised: '#2b2f38', selection: '#3d4352', fg: '#d5ced9', dim: '#6c6f7e', red: '#ee5d43', green: '#96e072', yellow: '#ffe66d', orange: '#f39c12', blue: '#7cb7ff', purple: '#c74ded', cyan: '#00e8c6' },
  { name: 'panda', bg: '#292a2b', dark: '#222324', raised: '#313233', selection: '#3e3f40', fg: '#e6e6e6', dim: '#676b79', red: '#ff2c6d', green: '#19f9d8', yellow: '#ffb86c', orange: '#ffcc95', blue: '#45a9f9', purple: '#b084eb', cyan: '#6fc1ff' },
  { name: 'poimandres', bg: '#1b1e28', dark: '#171922', raised: '#252b37', selection: '#303340', fg: '#a6accd', dim: '#767c9d', red: '#d0679d', green: '#5de4c7', yellow: '#fffac2', orange: '#f087bd', blue: '#add7ff', purple: '#fcc5e9', cyan: '#89ddff' },
  { name: 'oceanic-next', bg: '#1b2b34', dark: '#16232a', raised: '#343d46', selection: '#4f5b66', fg: '#c0c5ce', dim: '#65737e', red: '#ec5f67', green: '#99c794', yellow: '#fac863', orange: '#f99157', blue: '#6699cc', purple: '#c594c5', cyan: '#5fb3b3' },
  { name: 'tomorrow-night', bg: '#1d1f21', dark: '#161719', raised: '#282a2e', selection: '#373b41', fg: '#c5c8c6', dim: '#969896', red: '#cc6666', green: '#b5bd68', yellow: '#f0c674', orange: '#de935f', blue: '#81a2be', purple: '#b294bb', cyan: '#8abeb7' },
  { name: 'tomorrow-night-eighties', bg: '#2d2d2d', dark: '#252525', raised: '#393939', selection: '#515151', fg: '#cccccc', dim: '#999999', red: '#f2777a', green: '#99cc99', yellow: '#ffcc66', orange: '#f99157', blue: '#6699cc', purple: '#cc99cc', cyan: '#66cccc' },
  { name: 'catppuccin-macchiato', bg: '#24273a', dark: '#1e2030', raised: '#363a4f', selection: '#494d64', fg: '#cad3f5', dim: '#6e738d', red: '#ed8796', green: '#a6da95', yellow: '#eed49f', orange: '#f5a97f', blue: '#8aadf4', purple: '#c6a0f6', cyan: '#8bd5ca' },
  { name: 'catppuccin-frappe', bg: '#303446', dark: '#292c3c', raised: '#414559', selection: '#51576d', fg: '#c6d0f5', dim: '#737994', red: '#e78284', green: '#a6d189', yellow: '#e5c890', orange: '#ef9f76', blue: '#8caaee', purple: '#ca9ee6', cyan: '#81c8be' },
  { name: 'tokyonight-storm', bg: '#24283b', dark: '#1f2335', raised: '#292e42', selection: '#2e3c64', fg: '#c0caf5', dim: '#565f89', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', orange: '#ff9e64', blue: '#7aa2f7', purple: '#bb9af7', cyan: '#7dcfff' },
  { name: 'rose-pine-moon', bg: '#232136', dark: '#2a273f', raised: '#2a283e', selection: '#44415a', fg: '#e0def4', dim: '#6e6a86', red: '#eb6f92', green: '#3e8fb0', yellow: '#f6c177', orange: '#ea9a97', blue: '#9ccfd8', purple: '#c4a7e7', cyan: '#9ccfd8' },
  { name: 'kanagawa-dragon', bg: '#181616', dark: '#0d0c0c', raised: '#282727', selection: '#2d4f67', fg: '#c5c9c5', dim: '#737c73', red: '#c4746e', green: '#8a9a7b', yellow: '#c4b28a', orange: '#b6927b', blue: '#8ba4b0', purple: '#a292a3', cyan: '#8ea4a2' },
  { name: 'gruvbox-material', bg: '#282828', dark: '#1d2021', raised: '#32302f', selection: '#45403d', fg: '#d4be98', dim: '#7c6f64', red: '#ea6962', green: '#a9b665', yellow: '#d8a657', orange: '#e78a4e', blue: '#7daea3', purple: '#d3869b', cyan: '#89b482' },
  { name: 'sonokai', bg: '#2c2e34', dark: '#222327', raised: '#33353f', selection: '#414550', fg: '#e2e2e3', dim: '#7f8490', red: '#fc5d7c', green: '#9ed072', yellow: '#e7c664', orange: '#f39660', blue: '#76cce0', purple: '#b39df3', cyan: '#76cce0' },
  { name: 'duskfox', bg: '#232136', dark: '#191726', raised: '#2d2a45', selection: '#433c59', fg: '#e0def4', dim: '#817c9c', red: '#eb6f92', green: '#a3be8c', yellow: '#f6c177', orange: '#ea9a97', blue: '#569fba', purple: '#c4a7e7', cyan: '#9ccfd8' },
  { name: 'terafox', bg: '#152528', dark: '#0f1c1e', raised: '#1d3337', selection: '#293e40', fg: '#e6eaea', dim: '#6d7f8b', red: '#e85c51', green: '#7aa4a1', yellow: '#fda47f', orange: '#ff8349', blue: '#5a93aa', purple: '#ad5c7c', cyan: '#a1cdd8' },
  { name: 'moonfly', bg: '#080808', dark: '#000000', raised: '#1c1c1c', selection: '#303030', fg: '#bdbdbd', dim: '#808080', red: '#ff5d5d', green: '#8cc85f', yellow: '#e3c78a', orange: '#de935f', blue: '#80a0ff', purple: '#cf87e8', cyan: '#79dac8' },
  { name: 'oxocarbon', bg: '#161616', dark: '#0c0c0c', raised: '#262626', selection: '#393939', fg: '#f2f4f8', dim: '#6f6f6f', red: '#ee5396', green: '#42be65', yellow: '#ffe97b', orange: '#ff7eb6', blue: '#78a9ff', purple: '#be95ff', cyan: '#3ddbd9' },
  { name: 'iceberg', bg: '#161821', dark: '#0f1117', raised: '#1e2132', selection: '#272c42', fg: '#c6c8d1', dim: '#6b7089', red: '#e27878', green: '#b4be82', yellow: '#e2a478', orange: '#e2a478', blue: '#84a0c6', purple: '#a093c7', cyan: '#89b8c2' },
  { name: 'melange', bg: '#292522', dark: '#211e1b', raised: '#34302c', selection: '#403a36', fg: '#ece1d7', dim: '#867462', red: '#d47766', green: '#85b695', yellow: '#ebc06d', orange: '#e49b5d', blue: '#a3a9ce', purple: '#cf9bc2', cyan: '#89b3b6' },
  { name: 'jellybeans', bg: '#151515', dark: '#0e0e0e', raised: '#1c1c1c', selection: '#404040', fg: '#e8e8d3', dim: '#888888', red: '#cf6a4c', green: '#99ad6a', yellow: '#fad07a', orange: '#ffb964', blue: '#8197bf', purple: '#c6b6ee', cyan: '#8fbfdc' },
  { name: 'zenburn', bg: '#3f3f3f', dark: '#383838', raised: '#4f4f4f', selection: '#5f5f5f', fg: '#dcdccc', dim: '#7f9f7f', red: '#cc9393', green: '#9fc59f', yellow: '#f0dfaf', orange: '#dfaf8f', blue: '#8cd0d3', purple: '#dc8cc3', cyan: '#93e0e3' },
  { name: 'flexoki-dark', bg: '#100f0f', dark: '#0b0a0a', raised: '#1c1b1a', selection: '#282726', fg: '#cecdc3', dim: '#878580', red: '#d14d41', green: '#879a39', yellow: '#d0a215', orange: '#da702c', blue: '#4385be', purple: '#8b7ec8', cyan: '#3aa99f' },
]

export function themeNamed(name: string | undefined): Palette {
  return themes.find((t) => t.name === name) ?? builtins[0]
}

const builtins = themes.slice()
const colorKeys = ['bg', 'dark', 'raised', 'selection', 'fg', 'dim', 'red', 'green', 'yellow', 'orange', 'blue', 'purple', 'cyan'] as const

export function parseTheme(file: string, text: string): Palette | string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return `${file} isn't valid JSON`
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return `${file} isn't a theme`
  const d = data as Record<string, unknown>
  const bad = colorKeys.filter((k) => typeof d[k] !== 'string' || !/^#[0-9a-f]{6}$/i.test(d[k]))
  if (bad.length) return `${file}: ${bad.join(', ')} must be colors like #1a2b3c`
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : file.replace(/\.json$/i, '')
  const colors = Object.fromEntries(colorKeys.map((k) => [k, (d[k] as string).toLowerCase()]))
  return { name, ...colors } as Palette
}

export function setUserThemes(list: Palette[]) {
  const names = new Set(list.map((t) => t.name))
  themes.splice(0, themes.length, ...list, ...builtins.filter((t) => !names.has(t.name)))
}

function mix(a: string, b: string, amount: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (p: number, shift: number) => (p >> shift) & 255
  const out = [16, 8, 0].map((s) => Math.round(ch(pa, s) * (1 - amount) + ch(pb, s) * amount))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function applyChrome(p: Palette) {
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--bg-dark': p.dark,
    '--fg': p.fg,
    '--dim': p.dim,
    '--raised': p.raised,
    '--selection': p.selection,
    '--red': p.red,
    '--green': p.green,
    '--yellow': p.yellow,
    '--orange': p.orange,
    '--blue': p.blue,
    '--purple': p.purple,
    '--cyan': p.cyan,
    '--background': p.bg,
    '--foreground': p.fg,
    '--surface': p.dark,
    '--surface-foreground': p.fg,
    '--surface-secondary': p.raised,
    '--surface-tertiary': p.selection,
    '--overlay': p.dark,
    '--overlay-foreground': p.fg,
    '--muted': p.dim,
    '--default': p.raised,
    '--default-foreground': p.fg,
    '--accent': p.blue,
    '--accent-foreground': p.bg,
    '--success': p.green,
    '--success-foreground': p.bg,
    '--warning': p.yellow,
    '--warning-foreground': p.bg,
    '--danger': p.red,
    '--danger-foreground': p.bg,
    '--border': mix(p.bg, p.fg, 0.14),
    '--separator': mix(p.bg, p.fg, 0.1),
    '--focus': p.blue,
    '--field-background': p.raised,
    '--field-foreground': p.fg,
    '--field-placeholder': p.dim,
    '--segment': p.selection,
    '--segment-foreground': p.fg,
    '--backdrop': 'rgba(0, 0, 0, 0.45)',
  }
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.style.colorScheme = 'dark'
}

const strip = (c: string) => c.slice(1)

export function monacoTheme(p: Palette): Monaco.editor.IStandaloneThemeData {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: strip(p.fg) },
      { token: 'comment', foreground: strip(p.dim), fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(p.purple) },
      { token: 'keyword.flow', foreground: strip(p.purple) },
      { token: 'storage', foreground: strip(p.purple) },
      { token: 'string', foreground: strip(p.green) },
      { token: 'string.escape', foreground: strip(p.cyan) },
      { token: 'regexp', foreground: strip(p.cyan) },
      { token: 'number', foreground: strip(p.orange) },
      { token: 'constant', foreground: strip(p.orange) },
      { token: 'type', foreground: strip(p.yellow) },
      { token: 'type.identifier', foreground: strip(p.yellow) },
      { token: 'identifier', foreground: strip(p.fg) },
      { token: 'function', foreground: strip(p.blue) },
      { token: 'variable', foreground: strip(p.red) },
      { token: 'variable.predefined', foreground: strip(p.cyan) },
      { token: 'tag', foreground: strip(p.red) },
      { token: 'attribute.name', foreground: strip(p.orange) },
      { token: 'attribute.value', foreground: strip(p.green) },
      { token: 'delimiter', foreground: strip(p.fg) },
      { token: 'operator', foreground: strip(p.cyan) },
      { token: 'key', foreground: strip(p.red) },
      { token: 'string.key.json', foreground: strip(p.red) },
      { token: 'string.value.json', foreground: strip(p.green) },
      { token: 'metatag', foreground: strip(p.red) },
      { token: 'annotation', foreground: strip(p.yellow) },
      { token: 'markup.heading', foreground: strip(p.red), fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.fg,
      'editorLineNumber.foreground': p.dim,
      'editorLineNumber.activeForeground': p.fg,
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': p.selection,
      'editor.inactiveSelectionBackground': p.selection + '99',
      'editorCursor.foreground': p.fg,
      'editorWhitespace.foreground': p.raised,
      'editorIndentGuide.background1': p.raised,
      'editorIndentGuide.activeBackground1': p.selection,
      'editorWidget.background': p.dark,
      'editorWidget.border': p.raised,
      'editorSuggestWidget.background': p.dark,
      'editorSuggestWidget.selectedBackground': p.raised,
      'editorHoverWidget.background': p.dark,
      'input.background': p.raised,
      'scrollbarSlider.background': p.fg + '22',
      'scrollbarSlider.hoverBackground': p.fg + '33',
      'scrollbarSlider.activeBackground': p.fg + '44',
      'scrollbar.shadow': '#00000000',
      'editorOverviewRuler.border': '#00000000',
      'diffEditor.insertedTextBackground': p.green + '33',
      'diffEditor.removedTextBackground': p.red + '33',
      'diffEditor.insertedLineBackground': p.green + '1a',
      'diffEditor.removedLineBackground': p.red + '1a',
      'diffEditor.diagonalFill': p.raised,
      'diffEditorGutter.insertedLineBackground': p.green + '1a',
      'diffEditorGutter.removedLineBackground': p.red + '1a',
      'diffEditor.border': p.raised,
      'focusBorder': '#00000000',
    },
  }
}

export function xtermTheme(p: Palette): ITheme {
  return {
    background: p.bg,
    foreground: p.fg,
    cursor: p.fg,
    cursorAccent: p.bg,
    selectionBackground: p.selection,
    black: p.dark,
    red: p.red,
    green: p.green,
    yellow: p.yellow,
    blue: p.blue,
    magenta: p.purple,
    cyan: p.cyan,
    white: p.fg,
    brightBlack: p.dim,
    brightRed: p.red,
    brightGreen: p.green,
    brightYellow: p.yellow,
    brightBlue: p.blue,
    brightMagenta: p.purple,
    brightCyan: p.cyan,
    brightWhite: mix(p.fg, '#ffffff', 0.4),
  }
}
