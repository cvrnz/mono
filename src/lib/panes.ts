import type * as Monaco from 'monaco-editor'

export type PaneHandle = {
  focus(): void
  save?(as?: boolean, path?: string): Promise<boolean>
  isEmpty?(): boolean
  reveal?(line: number, col?: number): void
  vimEx?(command: string): void
  shellInput?(): boolean
  editor?: Monaco.editor.ICodeEditor
  step?(dir: number): boolean
  enter?(dir: number): void
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
