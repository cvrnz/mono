import { invoke } from './bridge'
import { toast } from './dialogs'
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
  S.set({ platform, settings: { ...S.defaultSettings, ...saved } })
  document.documentElement.dataset.platform = platform
  await loadUserThemes()
}

export function updateSettings(patch: Partial<S.Settings>): Promise<void> {
  const settings = { ...S.get().settings, ...patch }
  S.set({ settings })
  return invoke('save_settings', { data: JSON.stringify(settings) }).then(
    () => {},
    () => {},
  )
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
