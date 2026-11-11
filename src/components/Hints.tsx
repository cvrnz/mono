import { useEffect } from 'react'
import { shortcut } from '../lib/commands'
import * as S from '../lib/store'

export function useHints(id: string, items: string[]) {
  const key = items.join('\n')
  useEffect(() => S.setHints(id, key.split('\n')), [id, key])
  useEffect(() => () => S.setHints(id, null), [id])
}

const named = /^(Enter|Esc|Tab|Space|Home|End|Backspace|Delete)$/
const modified = /^(Shift|Alt|Ctrl|Cmd)\+|^[⌘⌥⌃⇧]/

/** Whether a hint starts with the keys it's about (like "j/k move"), rather than being a note (like "3 picked"). */
function keysOf(hint: string): string | null {
  const first = hint.split(' ')[0]
  if (/^\d+$/.test(first)) return null
  return first.split('/').every((k) => named.test(k) || modified.test(k) || [...k].length <= 2) ? first : null
}

function Hint({ text }: { text: string }) {
  const keys = keysOf(text)
  if (!keys) return <span>{text}</span>
  return (
    <span>
      {keys.split('/').map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
      {text.slice(keys.length + 1)}
    </span>
  )
}

export default function Hints({ items }: { items: string[] }) {
  return (
    <div className="hints">
      <span className="hints-keys">
        {items.map((item) => (
          <Hint key={item} text={item} />
        ))}
      </span>
      <span className="hints-nav">
        <Hint text={`${shortcut('NextPane')}/${shortcut('PreviousPane')} next/previous pane`} />
      </span>
    </div>
  )
}
