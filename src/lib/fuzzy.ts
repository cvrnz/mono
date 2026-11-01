
export type Match = { score: number; positions: number[] }

const boundary = /[\s/\\._\-:]/

export function fuzzy(query: string, text: string, isPath = false): Match | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const nameStart = isPath ? t.lastIndexOf('/') + 1 : 0

  let best: Match | null = null
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const m = matchFrom(q, t, text, start, nameStart)
    if (m && (!best || m.score > best.score)) best = m
    if (best && best.score > 1000) break
  }
  return best
}

function matchFrom(q: string, t: string, orig: string, start: number, nameStart: number): Match | null {
  const positions: number[] = []
  let score = 0
  let ti = start
  let prev = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    while (ti < t.length && t[ti] !== ch) ti++
    if (ti >= t.length) return null
    let s = 1
    if (ti === prev + 1) s += 5
    if (ti === 0 || boundary.test(t[ti - 1])) s += 8
    else if (orig[ti] !== t[ti] && orig[ti - 1] === t[ti - 1]) s += 6
    if (ti >= nameStart) s += 2
    score += s
    positions.push(ti)
    prev = ti
    ti++
  }
  score -= t.length * 0.05
  if (t === q) score += 2000
  else if (t.startsWith(q)) score += 1000
  else if (nameStart > 0 && t.slice(nameStart).startsWith(q)) score += 500
  return { score, positions }
}

export function highlight(text: string, positions: number[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  const set = new Set(positions)
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += text[i]
    else out.push({ text: text[i], hit })
  }
  return out
}
