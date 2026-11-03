import {
  file,
  fileExtensions,
  fileNames,
  folder,
  folderExpanded,
  languageIds,
  light,
} from 'material-icon-theme/dist/material-icons.json'
import { useSyncExternalStore } from 'react'
import { languageFor } from './monaco'
import { currentTheme } from './settings'
import * as S from './store'

export type IconPack = 'material' | 'vscode' | 'catppuccin'
export const iconPacks: { id: IconPack; name: string; desc: string }[] = [
  { id: 'material', name: 'Material', desc: 'Material Icon Theme' },
  { id: 'vscode', name: 'VSCodeIcons', desc: 'vscode-icons, the colorful set' },
  { id: 'catppuccin', name: 'Catppuccin', desc: 'Soft pastel icons' },
]

// `no-inline` keeps every SVG a separate asset, so only the icons on screen get loaded.
const materialUrls = import.meta.glob<string>('/node_modules/material-icon-theme/icons/*.svg', { eager: true, query: '?no-inline', import: 'default' })
const byName = new Map(Object.entries(materialUrls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]))

type Names = Record<string, string>
const lower = (m: Names) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]))
const dark = { fileNames: lower(fileNames), fileExtensions: fileExtensions as Names, languageIds: languageIds as Names }
const bright = { fileNames: lower(light.fileNames), fileExtensions: light.fileExtensions as Names, languageIds: light.languageIds as Names }

function isLight(): boolean {
  const hex = currentTheme().bg.replace('#', '')
  if (hex.length < 6) return false
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
}

type IconSet = { icons: Record<string, { body: string; width?: number; height?: number }>; width?: number; height?: number }
type Loaded = { set: IconSet; fileIcon?: (name: string) => string | undefined }
const loaded = new Map<IconPack, Loaded>()
const loading = new Map<IconPack, Promise<void>>()
let version = 0
const listeners = new Set<() => void>()

function load(pack: IconPack): void {
  if (pack === 'material' || loading.has(pack)) return
  const job =
    pack === 'vscode'
      ? Promise.all([import('@iconify-json/vscode-icons/icons.json'), import('vscode-icons-js')]).then(([j, v]) => ({
          set: j.default as IconSet,
          fileIcon: v.getIconForFile,
        }))
      : import('@iconify-json/catppuccin/icons.json').then((j) => ({ set: j.default as IconSet }))
  loading.set(
    pack,
    job.then(
      (l) => {
        loaded.set(pack, l)
        cache.clear()
        version++
        listeners.forEach((f) => f())
      },
      () => void loading.delete(pack),
    ),
  )
}

/** The pack to draw with (a highlighted one while picking), re-rendering once its icons arrive. */
export function useIconPack(): string {
  const pack = S.useStore((s) => s.previewIcons ?? s.settings.iconPack ?? 'material') as IconPack
  const v = useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => version,
  )
  load(pack)
  return `${pack}:${v}`
}

const svgs = new Map<string, string>()
function svgUrl(pack: IconPack, set: IconSet, name: string): string | undefined {
  const key = `${pack}:${name}`
  let url = svgs.get(key)
  if (url) return url
  const icon = set.icons[name]
  if (!icon) return undefined
  const w = icon.width ?? set.width ?? 16
  const h = icon.height ?? set.height ?? 16
  url = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${icon.body}</svg>`)}`
  svgs.set(key, url)
  return url
}

const catNames: Names = {
  'package.json': 'package-json', 'package-lock.json': 'npm-lock', 'bun.lock': 'bun-lock', 'bun.lockb': 'bun-lock', 'yarn.lock': 'yarn-lock',
  'pnpm-lock.yaml': 'pnpm-lock', 'cargo.toml': 'cargo', 'cargo.lock': 'cargo-lock', dockerfile: 'docker', 'docker-compose.yml': 'docker-compose',
  'compose.yaml': 'docker-compose', '.dockerignore': 'docker-ignore', '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git',
  'readme.md': 'readme', license: 'license', 'license.md': 'license', 'changelog.md': 'changelog', makefile: 'makefile',
  'tsconfig.json': 'typescript-config', '.env': 'env', '.editorconfig': 'editorconfig', '.prettierrc': 'prettier', 'tauri.conf.json': 'tauri',
  'agents.md': 'markdown', 'claude.md': 'markdown', '.npmrc': 'npm', 'deno.json': 'deno', 'go.mod': 'go-mod',
}
const catExts: Names = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript-react', 'd.ts': 'typescript-def', 'test.ts': 'typescript-test',
  'spec.ts': 'typescript-test', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript-react', 'test.js': 'javascript-test',
  rs: 'rust', py: 'python', pyc: 'python-compiled', md: 'markdown', mdx: 'markdown-mdx', yml: 'yaml', sh: 'bash', zsh: 'bash', fish: 'bash',
  h: 'c-header', hpp: 'cpp-header', cc: 'cpp', cxx: 'cpp', cs: 'csharp', rb: 'ruby', kt: 'kotlin', kts: 'kotlin', scss: 'sass',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'favicon', bmp: 'image', avif: 'image', mp4: 'video',
  mov: 'video', webm: 'video', mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', txt: 'text', sql: 'database', db: 'database',
  sqlite: 'database', exe: 'exe', zip: 'zip', gz: 'zip', tar: 'zip', tgz: 'zip', '7z': 'zip', ttf: 'font', otf: 'font', woff: 'font',
  woff2: 'font', pem: 'certificate', crt: 'certificate', ps1: 'powershell', bat: 'batch', cmd: 'batch', ex: 'elixir', exs: 'elixir',
  hs: 'haskell', ml: 'ocaml', jl: 'julia', tf: 'terraform', xlsx: 'ms-excel', xls: 'ms-excel', docx: 'ms-word', doc: 'ms-word',
  pptx: 'ms-powerpoint', wasm: 'web-assembly', ipynb: 'jupyter', htm: 'html', ini: 'config', conf: 'config', cfg: 'config', env: 'env',
}

function packIcon(pack: IconPack, l: Loaded, name: string, path: string, dir: boolean, open: boolean): string | undefined {
  const { set } = l
  if (pack === 'vscode') {
    if (dir) return svgUrl(pack, set, open ? 'default-folder-opened' : 'default-folder')
    const found = [name.toLowerCase(), name].map((n) => l.fileIcon?.(n)).find((n) => n && n !== 'default_file.svg')
    let n = found?.replace(/\.svg$/, '').replaceAll('_', '-') ?? 'default-file'
    const plain = n.replace('file-type-light-', 'file-type-')
    const bright = plain.replace('file-type-', 'file-type-light-')
    n = isLight() && set.icons[bright] ? bright : set.icons[plain] ? plain : n
    return svgUrl(pack, set, n) ?? svgUrl(pack, set, 'default-file')
  }
  if (dir) return svgUrl(pack, set, open ? 'folder-open' : 'folder')
  const lower = name.toLowerCase()
  const parts = lower.split('.')
  const tries = [catNames[lower]]
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    tries.push(catExts[ext], ext)
  }
  tries.push(languageFor(path), 'file')
  for (const t of tries) if (t && set.icons[t]) return svgUrl(pack, set, t)
  return undefined
}

const cache = new Map<string, string>()

export function iconFor(name: string, path: string, dir: boolean, open: boolean): string | undefined {
  const pack = (S.get().previewIcons ?? S.get().settings.iconPack ?? 'material') as IconPack
  const l = loaded.get(pack)
  if (pack !== 'material' && l) return packIcon(pack, l, name, path, dir, open)
  if (dir) return byName.get(open ? folderExpanded : folder)
  const lightTheme = isLight()
  const key = `${lightTheme ? 'l' : 'd'}:${path}`
  let icon = cache.get(key)
  if (icon === undefined) {
    icon = pick(name.toLowerCase(), path, lightTheme)
    cache.set(key, icon)
  }
  return byName.get(icon) ?? byName.get(file)
}

function pick(name: string, path: string, lightTheme: boolean): string {
  const maps = lightTheme ? [bright, dark] : [dark]
  for (const m of maps) if (m.fileNames[name]) return m.fileNames[name]
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    for (const m of maps) if (m.fileExtensions[ext]) return m.fileExtensions[ext]
  }
  const lang = languageFor(path)
  for (const m of maps) if (m.languageIds[lang]) return m.languageIds[lang]
  return file
}
