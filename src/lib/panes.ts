import type * as Monaco from 'monaco-editor'

export type PaneHandle = {
  focus(): void
  save?(as?: boolean, path?: string): Promise<boolean>
  isEmpty?(): boolean
  reveal?(line: number, col?: number, len?: number): void
  vimEx?(command: string): void
  shellInput?(): boolean
  find?(): void
  editor?: Monaco.editor.ICodeEditor
  step?(dir: number): boolean
  enter?(dir: number): void
  /** Types paths dragged in from the Explorer. */
  drop?(paths: string[]): void
}

const handles = new Map<string, PaneHandle>()

export function register(id: string, handle: PaneHandle): () => void {
  handles.set(id, handle)
  return () => {
    if (handles.get(id) === handle) handles.delete(id)
  }
}

export function pane(id: string | undefined | null): PaneHandle | undefined {
  return id ? handles.get(id) : undefined
}

/** The tab and pane under a point that paths dragged from the Explorer can be dropped into. */
export function dropTargetAt(x: number, y: number): { tab: string; pane: string } | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.pane[data-pane]')
  const { tab, pane: id } = el?.dataset ?? {}
  const h = pane(id)
  return tab && id && (h?.drop || (h?.editor && !h.editor.getRawOptions().readOnly)) ? { tab, pane: id } : null
}

/** Writes dropped paths into a file at the point they were dropped, or types them into a terminal. */
export function dropPaths(id: string, paths: string[], x: number, y: number) {
  const h = pane(id)
  if (h?.drop) return h.drop(paths)
  const editor = h?.editor
  const at = editor?.getTargetAtClientPoint(x, y)?.position ?? editor?.getPosition()
  if (!editor || !at) return
  const text = paths.join(' ')
  editor.executeEdits('drop', [{ range: { startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column }, text }])
  editor.setPosition({ lineNumber: at.lineNumber, column: at.column + text.length })
  editor.focus()
}
