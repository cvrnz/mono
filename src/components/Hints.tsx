import { useEffect } from 'react'
import { keyLabel } from '../lib/commands'
import * as S from '../lib/store'

export function useHints(id: string, items: string[]) {
  const key = items.join('\n')
  useEffect(() => S.setHints(id, key.split('\n')), [id, key])
  useEffect(() => () => S.setHints(id, null), [id])
}

export default function Hints({ items }: { items: string[] }) {
  return (
    <div className="hints">
      <span className="hints-keys">
        {items.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </span>
      <span className="hints-nav">{keyLabel('J')}/K next/previous pane</span>
    </div>
  )
}
