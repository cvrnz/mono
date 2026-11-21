import { useEffect } from 'react'
import * as S from './store'

export function useHints(id: string, items: string[]) {
  const key = items.join('\n')
  useEffect(() => S.setHints(id, key.split('\n')), [id, key])
  useEffect(() => () => S.setHints(id, null), [id])
}
