
const drive = /^[A-Za-z]:(\/|$)/

function rootOf(p: string): string {
  if (p.startsWith('/')) return '/'
  const m = p.match(drive)
  return m ? p.slice(0, 2) + '/' : ''
}

export function isAbsolute(p: string): boolean {
  return rootOf(p) !== ''
}

export function basename(p: string): string {
  const root = rootOf(p)
  if (root && normalize(p) === root) return root
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || '/'
}

export function dirname(p: string): string {
  const root = rootOf(p)
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  if (i < 0) return root || '.'
  if (i < root.length) return root
  return trimmed.slice(0, i) || root
}

export function join(...parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (!part) continue
    if (isAbsolute(part)) out = part
    else out = out.endsWith('/') ? out + part : `${out}/${part}`
  }
  return normalize(out)
}

export function normalize(p: string): string {
  const root = rootOf(p)
  const out: string[] = []
  for (const seg of p.slice(root.length).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return root + out.join('/')
}

export function pretty(p: string, root: string, home: string): string {
  if (root && (p === root || p.startsWith(root + '/'))) return p.slice(root.length + 1) || basename(p)
  if (home && (p === home || p.startsWith(home + '/'))) return '~' + p.slice(home.length)
  return p
}

export function isInside(p: string, dir: string): boolean {
  return p === dir || p.startsWith(dir.endsWith('/') ? dir : dir + '/')
}
