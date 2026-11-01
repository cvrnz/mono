import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { themes, monacoTheme } from './themes'

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  },
}

for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    jsx: monaco.typescript.JsxEmit.Preserve,
    allowJs: true,
    target: monaco.typescript.ScriptTarget.ESNext,
  })
}

for (const t of themes) {
  monaco.editor.defineTheme(t.name, monacoTheme(t))
}

const byName: Record<string, string> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'plaintext',
  jenkinsfile: 'groovy',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
  '.bash_profile': 'shell',
  '.env': 'ini',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
}

export function languageFor(path: string | null, firstLine?: string): string {
  const id = guessLanguage(path, firstLine)
  return monaco.languages.getLanguages().some((l) => l.id === id) ? id : 'plaintext'
}

function guessLanguage(path: string | null, firstLine?: string): string {
  if (!path) return 'plaintext'
  const base = path.split('/').pop()!.toLowerCase()
  if (byName[base]) return byName[base]
  if (/\.(tf|tfvars|hcl)$/.test(base)) return 'hcl'
  if (/\.(jsonc|json5)$/.test(base) || base === 'tsconfig.json') return 'json'
  const ext = base.includes('.') ? '.' + base.split('.').pop() : ''
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.filenames?.some((f) => f.toLowerCase() === base)) return lang.id
  }
  for (const lang of monaco.languages.getLanguages()) {
    if (ext && lang.extensions?.includes(ext)) return lang.id
  }
  if (firstLine?.startsWith('#!')) {
    if (/\b(ba|z|k)?sh\b/.test(firstLine)) return 'shell'
    if (/python/.test(firstLine)) return 'python'
    if (/node|deno|bun/.test(firstLine)) return 'javascript'
    if (/ruby/.test(firstLine)) return 'ruby'
    if (/perl/.test(firstLine)) return 'perl'
  }
  return 'plaintext'
}

const names: Record<string, string> = {
  plaintext: 'Plain Text',
  shell: 'Shell Script',
  json: 'JSON',
  yaml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sql: 'SQL',
  xml: 'XML',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  ini: 'Properties',
  hcl: 'HCL',
  dockerfile: 'Dockerfile',
  markdown: 'Markdown',
  go: 'Go',
  python: 'Python',
  java: 'Java',
  rust: 'Rust',
}

export function languageName(id: string, path?: string | null): string {
  if (path && /\.tsx$/.test(path)) return 'TypeScript React'
  if (path && /\.jsx$/.test(path)) return 'JavaScript React'
  if (names[id]) return names[id]
  const lang = monaco.languages.getLanguages().find((l) => l.id === id)
  return lang?.aliases?.[0] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

export { monaco }
