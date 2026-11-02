import { useEffect, useMemo, useRef, useState } from 'react'
import { agentFor } from '../lib/agent'
import { sidebarFocused } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import * as S from '../lib/store'

function lineClass(line: string): string | null {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')) return 'git-file-line'
  if (line.startsWith('+')) return 'git-add-line'
  if (line.startsWith('-')) return 'git-del-line'
  if (line.startsWith('@@')) return 'git-hunk-line'
  if (line.startsWith('commit ')) return 'git-commit-line'
  return null
}

export default function CommitPane({ tab, active }: { tab: S.CommitTab; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [note, setNote] = useState('')
  const project = S.useProjectId()
  const agent = useMemo(() => agentFor(project), [project])
  const settings = S.useStore((s) => s.settings)

  useEffect(() => {
    const st = S.get().settings
    const ed = monaco.editor.create(host.current!, {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'off',
      wordWrap: st.wordWrap ? 'on' : 'off',
      lineDecorationsWidth: '2ch',
      folding: false,
      glyphMargin: false,
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      fontFamily: st.fontFamily,
      fontSize: st.fontSize,
      overviewRulerLanes: 0,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      guides: { indentation: false },
      stickyScroll: { enabled: false },
      occurrencesHighlight: 'off',
      matchBrackets: 'never',
    })
    editorRef.current = ed
    const unregister = register(tab.id, { focus: () => ed.focus(), editor: ed })
    return () => {
      unregister()
      const m = ed.getModel()
      ed.dispose()
      m?.dispose()
    }
  }, [tab.id])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: settings.fontSize, fontFamily: settings.fontFamily, wordWrap: settings.wordWrap ? 'on' : 'off' })
  }, [settings.fontSize, settings.fontFamily, settings.wordWrap])

  useEffect(() => {
    let stale = false
    agent.show(tab.repo, tab.hash).then(
      ({ text }) => {
        const ed = editorRef.current
        if (stale || !ed) return
        setNote('')
        const prev = ed.getModel()
        const model = monaco.editor.createModel(text, 'plaintext')
        ed.setModel(model)
        prev?.dispose()
        const decorations: monaco.editor.IModelDeltaDecoration[] = []
        text.split('\n').forEach((line, i) => {
          const cls = lineClass(line)
          if (cls) decorations.push({ range: new monaco.Range(i + 1, 1, i + 1, line.length + 1), options: { isWholeLine: true, className: cls, inlineClassName: cls + '-text' } })
        })
        ed.createDecorationsCollection(decorations)
      },
      (err) => !stale && setNote(errorText(err)),
    )
    return () => {
      stale = true
    }
  }, [agent, tab.repo, tab.hash])

  useEffect(() => {
    if (active && !sidebarFocused()) requestAnimationFrame(() => editorRef.current?.focus())
    if (active) S.setPaneStatus(tab.id, { mode: 'normal', items: [tab.hash.slice(0, 10)] })
  }, [active, tab.id, tab.hash])
  useEffect(
    () => () =>
      S.set((s) => {
        const status = { ...s.status }
        delete status[tab.id]
        return { status }
      }),
    [tab.id],
  )

  return (
    <div className="pane-inner">
      <div ref={host} className="editor-host" style={{ visibility: note ? 'hidden' : undefined }} />
      {note && <div className="editor-note">{note}</div>}
    </div>
  )
}
