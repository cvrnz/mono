import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { currentTheme } from '../lib/settings'
import Icon from './Icon'

type Props = { term: Terminal; search: SearchAddon; onClose: () => void }

function decorations() {
  const t = currentTheme()
  return { matchBackground: t.selection, matchOverviewRuler: t.dim, activeMatchBackground: t.yellow + '88', activeMatchColorOverviewRuler: t.yellow }
}

/** A find bar over a terminal: Enter for the next match, Shift+Enter for the previous one, Esc to close. */
export default function TermFind({ term, search, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [found, setFound] = useState<{ index: number; count: number } | null>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) => setFound({ index: resultIndex, count: resultCount }))
    return () => {
      sub.dispose()
      search.clearDecorations()
    }
  }, [search])

  const find = (q: string, back = false, incremental = false) => {
    if (!q) {
      search.clearDecorations()
      setFound(null)
      return
    }
    const opts = { incremental, decorations: decorations() }
    if (back) search.findPrevious(q, opts)
    else search.findNext(q, opts)
  }

  const close = () => {
    search.clearDecorations()
    term.clearSelection()
    onClose()
    term.focus()
  }

  return (
    <div className="term-find" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        value={text}
        spellCheck={false}
        autoComplete="off"
        placeholder="Find"
        onChange={(e) => {
          setText(e.target.value)
          find(e.target.value, false, true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(text, e.shiftKey)
          else if (e.key === 'Escape') close()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      />
      <span className="term-find-count">{text ? (found && found.count ? `${found.index + 1} of ${found.count}` : 'No results') : ''}</span>
      <span className="icon-btn" title="Previous (Shift+Enter)" onMouseDown={(e) => (e.preventDefault(), find(text, true))}>
        <Icon name="up" />
      </span>
      <span className="icon-btn" title="Next (Enter)" onMouseDown={(e) => (e.preventDefault(), find(text))}>
        <Icon name="down" />
      </span>
      <span className="icon-btn" title="Close (Esc)" onMouseDown={(e) => (e.preventDefault(), close())}>
        <Icon name="close" />
      </span>
    </div>
  )
}
