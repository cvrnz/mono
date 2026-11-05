import { initVimMode, type VimAdapterInstance } from 'monaco-vim'
import { useEffect, useRef, useState } from 'react'
import { agentFor } from '../lib/agent'
import { askPath, okToWrite, sidebarFocused } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { toast } from '../lib/dialogs'
import { charWidth } from '../lib/metrics'
import { languageFor, languageName, monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import { basename } from '../lib/paths'
import * as S from '../lib/store'
import { setupVim, Vim } from '../lib/vim'
import { previewFor } from '../lib/viewers'
import Preview from './Preview'

type Props = { tab: S.FileTab; active: boolean; centered: boolean }

function modeOf(ev: { mode: string; subMode?: string }) {
  if (ev.mode === 'visual') return ev.subMode === 'linewise' ? 'visual-line' : ev.subMode === 'blockwise' ? 'visual-block' : 'visual'
  return ev.mode
}

export default function EditorPane({ tab, active, centered }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const vimNode = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const vimRef = useRef<VimAdapterInstance | null>(null)
  const modeRef = useRef('normal')
  const savedVersion = useRef(0)
  const pathRef = useRef(tab.path)
  const [note, setNote] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const textTimer = useRef(0)

  const settings = S.useStore((s) => s.settings)
  const project = S.useProjectId()
  const { vim, lineNumbers, fontSize, fontFamily, maxColumns, wordWrap } = settings
  const previewKind = previewFor(tab.path)
  const showPreview = previewKind !== null && settings.preview !== false

  useEffect(() => {
    let disposed = false
    const agent = agentFor(project)
    const editor = monaco.editor.create(host.current!, {
      model: null,
      automaticLayout: true,
      fontFamily: S.get().settings.fontFamily,
      fontSize: S.get().settings.fontSize,
      lineNumbers: S.get().settings.lineNumbers ? 'on' : 'off',
      wordWrap: S.get().settings.wordWrap ? 'on' : 'off',
      lineDecorationsWidth: '2ch',
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: false,
      minimap: { enabled: false },
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      stickyScroll: { enabled: false },
      guides: { indentation: false },
      occurrencesHighlight: 'off',
      renderWhitespace: 'none',
      contextmenu: true,
      fixedOverflowWidgets: true,
      padding: { top: 0 },
      cursorSurroundingLines: 3,
      smoothScrolling: false,
    })
    editorRef.current = editor

    const status = () => {
      const model = editor.getModel()
      if (!model) return
      const pos = editor.getPosition() ?? { lineNumber: 1, column: 1 }
      let position = `Ln ${pos.lineNumber}, Col ${pos.column}`
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        const lines = sel.endLineNumber - sel.startLineNumber + 1
        position += lines === 1 ? ` (${model.getValueInRange(sel).length} selected)` : ` (${lines} lines selected)`
      }
      const opts = model.getOptions()
      const markers = monaco.editor.getModelMarkers({ resource: model.uri })
      S.setPaneStatus(tab.id, {
        mode: S.get().settings.vim ? modeRef.current : 'insert',
        errors: markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length,
        warnings: markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length,
        items: [
          position,
          opts.insertSpaces ? `Spaces: ${opts.indentSize}` : `Tab Size: ${opts.tabSize}`,
          'UTF-8',
          model.getEOL() === '\r\n' ? 'CRLF' : 'LF',
          languageName(model.getLanguageId(), pathRef.current),
        ],
      })
    }

    const goTo = (line: number, col = 0, len = 0) => {
      const end = S.get().settings.vim ? 0 : len
      editor.setSelection(new monaco.Range(line, col + 1, line, col + 1 + end))
      editor.revealLineInCenter(line)
    }

    const attach = (content: string) => {
      const path = pathRef.current
      const firstLine = content.slice(0, content.indexOf('\n') >>> 0)
      const uri = monaco.Uri.from({ scheme: 'file', path: `/${tab.id}${path ?? '/untitled'}` })
      const model = monaco.editor.createModel(content, languageFor(path, firstLine), uri)
      model.detectIndentation(true, 4)
      editor.setModel(model)
      savedVersion.current = model.getAlternativeVersionId()
      setText(content)
      model.onDidChangeContent(() => {
        clearTimeout(textTimer.current)
        textTimer.current = window.setTimeout(() => setText(model.getValue()), 150)
        const dirty = model.getAlternativeVersionId() !== savedVersion.current
        const t = S.project(project)?.tabs.find((x) => x.id === tab.id)
        if (t?.kind === 'file' && (t.dirty !== dirty || (dirty && t.preview))) S.updateTab(tab.id, dirty ? { dirty, preview: false } : { dirty })
        status()
      })
      if (tab.line) goTo(tab.line, tab.col, tab.len)
      setLoaded(true)
      status()
    }

    if (tab.path) {
      agent
        .read(tab.path)
        .then((r) => {
          if (disposed) return
          if (r.binary) setNote(`${basename(tab.path!)} is a binary file (${r.size.toLocaleString()} bytes) and can't be shown.`)
          else if (r.tooLarge) setNote(`${basename(tab.path!)} is too large to open (${(r.size / 1048576).toFixed(1)} MB).`)
          else attach(r.content)
        })
        .catch((err) => {
          if (disposed) return
          if (/no such file/i.test(errorText(err))) attach('')
          else setNote(errorText(err))
        })
    } else {
      attach(tab.text ?? '')
    }

    const subs = [
      editor.onDidChangeCursorSelection(status),
      editor.onDidFocusEditorText(status),
      monaco.editor.onDidChangeMarkers((uris) => {
        const m = editor.getModel()
        if (m && uris.some((u) => u.toString() === m.uri.toString())) status()
      }),
    ]

    const save = async (as = false, to?: string): Promise<boolean> => {
      const model = editor.getModel()
      if (!model) return false
      let path = to ?? pathRef.current
      if (!path || (as && !to)) {
        path = await askPath(as ? 'Save as' : 'Save new file', pathRef.current && as ? pathRef.current : '')
        if (!path) return false
        if (!(await okToWrite(path))) return false
      } else if (to && to !== pathRef.current && !(await okToWrite(to))) {
        return false
      }
      const version = model.getAlternativeVersionId()
      try {
        await agent.write(path, model.getValue())
      } catch (err) {
        toast(`Couldn't save ${basename(path)}: ${errorText(err)}`, 'error')
        return false
      }
      savedVersion.current = version
      if (path !== pathRef.current) {
        pathRef.current = path
        monaco.editor.setModelLanguage(model, languageFor(path, model.getLineContent(1)))
      }
      S.updateTab(tab.id, { path, dirty: model.getAlternativeVersionId() !== version })
      status()
      return true
    }

    const unregister = register(tab.id, {
      focus: () => editor.focus(),
      save,
      isEmpty: () => (editor.getModel()?.getValueLength() ?? 0) === 0,
      reveal: goTo,
      vimEx: (command) => {
        if (vimRef.current) Vim.handleEx(vimRef.current, command)
      },
      editor,
    })

    return () => {
      disposed = true
      clearTimeout(textTimer.current)
      unregister()
      subs.forEach((s) => s.dispose())
      vimRef.current?.dispose()
      vimRef.current = null
      const model = editor.getModel()
      editor.dispose()
      model?.dispose()
      S.set((s) => {
        const status = { ...s.status }
        delete status[tab.id]
        return { status }
      })
    }
  }, [tab.id])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (tab.path && tab.path !== pathRef.current) {
      pathRef.current = tab.path
      if (model) monaco.editor.setModelLanguage(model, languageFor(tab.path, model.getLineContent(1)))
    }
  }, [tab.path])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !loaded) return
    if (!vim) {
      modeRef.current = 'insert'
      return
    }
    setupVim()
    const adapter = initVimMode(editor, vimNode.current)
    vimRef.current = adapter
    modeRef.current = 'normal'
    const onMode = (ev: { mode: string; subMode?: string }) => {
      modeRef.current = modeOf(ev)
      const st = S.get().status[tab.id]
      if (st) S.setPaneStatus(tab.id, { ...st, mode: modeRef.current })
    }
    adapter.on('vim-mode-change', onMode)
    const st = S.get().status[tab.id]
    if (st) S.setPaneStatus(tab.id, { ...st, mode: 'normal' })
    return () => {
      adapter.dispose()
      if (vimRef.current === adapter) vimRef.current = null
      modeRef.current = 'insert'
    }
  }, [vim, loaded, tab.id])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize, fontFamily, lineNumbers: lineNumbers ? 'on' : 'off', wordWrap: wordWrap ? 'on' : 'off' })
  }, [fontSize, fontFamily, lineNumbers, wordWrap])

  useEffect(() => {
    if (active && loaded && !sidebarFocused()) {
      editorRef.current?.focus()
    }
  }, [active, loaded])

  const [, setFontsReady] = useState(0)
  useEffect(() => {
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1))
  }, [])

  const width = Math.ceil(maxColumns * charWidth(fontFamily, fontSize)) + 12
  const center = centered && !showPreview
  return (
    <div className={`pane-inner ${center ? 'centered' : ''}`} style={center ? { maxWidth: width } : undefined}>
      <div ref={host} className={`editor-host ${showPreview ? 'with-preview' : ''}`} style={{ visibility: note ? 'hidden' : undefined }} />
      {showPreview && loaded && !note && <Preview id={tab.id} kind={previewKind} text={text} path={tab.path!} />}
      {note && (
        <div className="editor-note" tabIndex={0} ref={(el) => {
            if (el && active && !sidebarFocused()) el.focus()
          }}>
          {note}
        </div>
      )}
      <div ref={vimNode} className="vim-status" />
    </div>
  )
}
