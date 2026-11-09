import { getCurrentWebview } from '@tauri-apps/api/webview'
import { errorText, invoke } from './bridge'
import { toast } from './dialogs'
import { oldDefaultFont } from './fonts'
import { monaco } from './monaco'
import * as S from './store'
import { applyChrome, monacoTheme, type Palette, parseTheme, setUserThemes, themeNamed } from './themes'

export async function loadSettings() {
  const [raw, platform] = await Promise.all([invoke<string>('settings').catch(() => '{}'), invoke<string>('platform').catch(() => 'darwin')])
  let saved: Partial<S.Settings> = {}
  try {
    saved = JSON.parse(raw)
  } catch {
  }
  if (saved.fontFamily === oldDefaultFont) delete saved.fontFamily
  S.set({ platform, settings: { ...S.defaultSettings, ...saved } })
  applyZoom()
  document.documentElement.dataset.platform = platform
  await loadUserThemes()
  void installThemes()
}

async function installThemes() {
  let added = false
  for (const repo of S.get().settings.themeRepos) {
    try {
      if (await invoke<boolean>('theme_install', { repo })) added = true
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  if (added) await loadUserThemes()
}

export async function addThemeRepo(repo: string) {
  repo = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')
  const repos = S.get().settings.themeRepos
  if (repos.includes(repo)) {
    await updateThemeRepos([repo])
    return
  }
  await invoke('theme_install', { repo })
  await updateSettings({ themeRepos: [...repos, repo] })
  await loadUserThemes()
  toast(`Added ${repo}`)
}

export async function removeThemeRepo(repo: string) {
  await invoke('theme_remove', { repo })
  await updateSettings({ themeRepos: S.get().settings.themeRepos.filter((r) => r !== repo) })
  await loadUserThemes()
  toast(`Removed ${repo}`)
}

export async function updateThemeRepos(repos = S.get().settings.themeRepos) {
  const failed: string[] = []
  for (const repo of repos) {
    await invoke('theme_update', { repo }).catch((e) => failed.push(errorText(e)))
  }
  await loadUserThemes()
  if (failed.length) toast(failed.join('\n'), 'error')
  else toast(repos.length === 1 ? `Updated ${repos[0]}` : `Updated ${repos.length} themes`)
}

export function updateSettings(patch: Partial<S.Settings>): Promise<void> {
  const settings = { ...S.get().settings, ...patch }
  S.set({ settings })
  return invoke('save_settings', { data: JSON.stringify(settings) }).then(
    () => {},
    () => {},
  )
}

const zoomSteps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function applyZoom() {
  getCurrentWebview()
    .setZoom(S.get().settings.zoom ?? 1)
    .catch(() => {})
}

/** Makes everything in the window bigger (1) or smaller (-1) a step at a time, like a browser, or back to normal (0). */
export function zoom(step: 1 | -1 | 0) {
  const now = S.get().settings.zoom ?? 1
  const next = step === 0 ? 1 : step > 0 ? (zoomSteps.find((z) => z > now + 0.001) ?? now) : (zoomSteps.findLast((z) => z < now - 0.001) ?? now)
  if (next === now && step !== 0) return
  void updateSettings({ zoom: next === 1 ? undefined : next })
  applyZoom()
  toast(`Zoom ${Math.round(next * 100)}%`)
}

export function currentTheme() {
  const s = S.get()
  return themeNamed(s.previewTheme ?? s.settings.theme)
}

let applied = ''
export function applyTheme() {
  const p = currentTheme()
  if (p.name === applied) return
  applied = p.name
  applyChrome(p)
  monaco.editor.setTheme(p.name)
}

export async function loadUserThemes() {
  const files = await invoke<{ file: string; text: string }[]>('themes').catch(() => [])
  const list: Palette[] = []
  for (const f of files ?? []) {
    const t = parseTheme(f.file, f.text)
    if (typeof t === 'string') {
      toast(t, 'error')
      continue
    }
    monaco.editor.defineTheme(t.name, monacoTheme(t))
    list.push(t)
  }
  setUserThemes(list)
  applied = ''
  applyTheme()
}
