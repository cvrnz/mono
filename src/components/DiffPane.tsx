import { useEffect, useMemo, useRef, useState } from 'react'
import { agentFor } from '../lib/agent'
import { sidebarFocused } from '../lib/actions'
import { errorText } from '../lib/bridge'
import { languageFor, monaco } from '../lib/monaco'
import { register } from '../lib/panes'
import { basename } from '../lib/paths'
import * as S from '../lib/store'

export function diffLabel(tab: S.DiffTab): string {
  const c = tab.change
  const what = c.status === 'D' ? 'Deleted' : c.status === 'A' || c.status === 'U' ? 'Untracked' : 'Working Tree'
  return `${basename(c.path)} (${what})`
}

export default function DiffPane({ tab, active }: { tab: S.DiffTab; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const [note, setNote] = useState('')
  const project = S.useProjectId()
  const agent = useMemo(() => agentFor(project), [project])
  const settings = S.useStore((s) => s.settings)
  const { change, repo } = tab

  useEffect(() => {
    const st = S.get().settings
    const diff = monaco.editor.createDiffEditor(host.current!, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      enableSplitViewResizing: true,
      fontFamily: st.fontFamily,
      fontSize: st.fontSize,
      lineNumbers: st.lineNumbers ? 'on' : 'off',
      wordWrap: st.wordWrap ? 'on' : 'off',
      minimap: { enabled: false },
      folding: false,
      glyphMargin: false,
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      lineDecorationsWidth: '2ch',
      renderIndicators: false,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      hideUnchangedRegions: { enabled: false },
      stickyScroll: { enabled: false },
    })
    diffRef.current = diff
    const unregister = register(tab.id, { focus: () => diff.getModifiedEditor().focus(), editor: diff.getModifiedEditor() })
    return () => {
      unregister()
      const m = diff.getModel()
      diff.dispose()
      m?.original.dispose()
      m?.modified.dispose()
    }
  }, [tab.id])

  useEffect(() => {
    diffRef.current?.updateOptions({
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      lineNumbers: settings.lineNumbers ? 'on' : 'off',
      wordWrap: settings.wordWrap ? 'on' : 'off',
    })
  }, [settings.fontSize, settings.fontFamily, settings.lineNumbers, settings.wordWrap])

  useEffect(() => {
    if (!active) return
    let stale = false
    agent.versions(repo, change).then(
      (v) => {
        const diff = diffRef.current
        if (stale || !diff) return
        if (v.old.binary || v.new.binary) {
          setNote(`${basename(change.path)} is a binary file`)
          return
        }
        setNote('')
        const prev = diff.getModel()
        if (prev && prev.original.getValue() === v.old.content && prev.modified.getValue() === v.new.content) return
        const lang = languageFor(change.path, v.new.content.split('\n', 1)[0])
        diff.setModel({ original: monaco.editor.createModel(v.old.content, lang), modified: monaco.editor.createModel(v.new.content, lang) })
        prev?.original.dispose()
        prev?.modified.dispose()
      },
      (err) => !stale && setNote(errorText(err)),
    )
    if (!sidebarFocused()) requestAnimationFrame(() => diffRef.current?.getModifiedEditor().focus())
    return () => {
      stale = true
    }
  }, [active, agent, repo, change])

  useEffect(() => {
    if (active) S.setPaneStatus(tab.id, { mode: 'normal', items: [change.old ? `${change.old} → ${change.path}` : change.path] })
  }, [active, tab.id, change])
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
    <div className="scm-diff diff-pane">
      <div className="scm-labels">
        <div>{` ${change.old ?? change.path}  (last commit)`}</div>
        <div>{` ${change.path}  (working tree)`}</div>
      </div>
      <div className="scm-editor">
        <div ref={host} style={{ position: 'absolute', inset: 0, visibility: note ? 'hidden' : undefined }} />
        {note && <div className="editor-note">{note}</div>}
      </div>
    </div>
  )
}
