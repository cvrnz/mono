import {
  file,
  fileExtensions,
  fileNames,
  folder,
  folderExpanded,
  folderNames,
  folderNamesExpanded,
  languageIds,
  light,
  rootFolder,
  rootFolderExpanded,
} from 'material-icon-theme/dist/material-icons.json'
import { languageFor } from './monaco'
import { currentTheme } from './settings'

// `no-inline` keeps every SVG a separate asset, so only the icons on screen get loaded.
const urls = import.meta.glob<string>('/node_modules/material-icon-theme/icons/*.svg', { eager: true, query: '?no-inline', import: 'default' })
const byName = new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4), url]))

type Names = Record<string, string>
const lower = (m: Names) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]))
const dark = { fileNames: lower(fileNames), fileExtensions: fileExtensions as Names, languageIds: languageIds as Names, folderNames: lower(folderNames), folderNamesExpanded: lower(folderNamesExpanded) }
const bright = {
  fileNames: lower(light.fileNames),
  fileExtensions: light.fileExtensions as Names,
  languageIds: light.languageIds as Names,
  folderNames: lower(light.folderNames),
  folderNamesExpanded: lower(light.folderNamesExpanded),
}

function isLight(): boolean {
  const hex = currentTheme().bg.replace('#', '')
  if (hex.length < 6) return false
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
}

const cache = new Map<string, string>()

export function iconFor(name: string, path: string, dir: boolean, open: boolean, root = false): string | undefined {
  const lightTheme = isLight()
  const key = `${lightTheme ? 'l' : 'd'}${dir ? (open ? 'o' : 'c') : 'f'}${root ? 'r' : ''}:${dir ? name.toLowerCase() : path}`
  let icon = cache.get(key)
  if (icon === undefined) {
    icon = pick(name.toLowerCase(), path, dir, open, root, lightTheme)
    cache.set(key, icon)
  }
  return byName.get(icon) ?? byName.get(dir ? folder : file)
}

function pick(name: string, path: string, dir: boolean, open: boolean, root: boolean, lightTheme: boolean): string {
  const maps = lightTheme ? [bright, dark] : [dark]
  if (root) return open ? rootFolderExpanded : rootFolder
  if (dir) {
    for (const m of maps) {
      const hit = (open ? m.folderNamesExpanded : m.folderNames)[name]
      if (hit) return hit
    }
    return open ? folderExpanded : folder
  }
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
