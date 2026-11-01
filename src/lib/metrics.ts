const cache = new Map<string, number>()

export function charWidth(fontFamily: string, fontSize: number): number {
  const key = `${fontSize}px ${fontFamily}`
  let w = cache.get(key)
  if (w === undefined) {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = key
    w = ctx.measureText('M'.repeat(100)).width / 100
    if (document.fonts?.status === 'loaded') cache.set(key, w)
  }
  return w
}
