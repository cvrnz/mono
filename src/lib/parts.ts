import { useEffect, useRef, useState } from 'react'

export type Part = { name: string; focus(): void }

export function useParts(initial: string, parts: Part[]) {
  const [part, setPart] = useState(initial)
  const list = useRef<Part[]>([])
  useEffect(() => {
    list.current = parts
  })
  const current = useRef(part)
  useEffect(() => {
    current.current = part
  }, [part])
  const [nav] = useState(() => ({
    step(dir: number): boolean {
      const l = list.current
      const i = l.findIndex((p) => p.name === current.current)
      const next = i < 0 ? undefined : l[i + dir]
      if (!next) return false
      next.focus()
      return true
    },
    enter(dir: number) {
      const l = list.current
      ;(dir > 0 ? l[0] : l[l.length - 1])?.focus()
    },
  }))
  return { part, setPart, nav }
}
