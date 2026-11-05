import { strFromU8, unzipSync } from 'fflate'

export type Sheet = {
  name: string
  /** Cell text by row, then column (both from 0); missing cells are undefined. */
  rows: (string | undefined)[][]
  cols: number
  /** Column widths in characters, where the file sets them. */
  widths: (number | undefined)[]
  numeric: Set<string>
}

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml')
const all = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name))
const first = (node: Document | Element, name: string) => node.getElementsByTagNameNS('*', name)[0] as Element | undefined
const text = (node: Element) =>
  all(node, 't')
    .filter((t) => !t.closest('rPh'))
    .map((t) => t.textContent ?? '')
    .join('')

/** Built-in number formats that show dates or times. */
const dateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare)
}

function columnIndex(ref: string): number {
  let n = 0
  for (const ch of ref) {
    const c = ch.charCodeAt(0)
    if (c < 65 || c > 90) break
    n = n * 26 + (c - 64)
  }
  return n - 1
}

export function columnName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function dateText(serial: number, time: boolean): string {
  const d = new Date(Math.round((serial - 25569) * 86400000))
  const iso = d.toISOString()
  if (!time) return iso.slice(0, 10)
  return serial < 1 ? iso.slice(11, 19) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
}

function numberText(v: number, format: string): string {
  if (/%/.test(format)) {
    const places = format.match(/\.(0+)%/)?.[1].length ?? 0
    return `${(v * 100).toFixed(places)}%`
  }
  const places = format.match(/0\.(0+)/)?.[1].length
  if (places !== undefined) return v.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places, useGrouping: format.includes(',') })
  if (format.includes('#,##0') || format.includes(',')) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return String(Math.round(v * 1e10) / 1e10)
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = ('xl/' + target).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

export function readWorkbook(data: Uint8Array): Sheet[] {
  const zip = unzipSync(data)
  const file = (path: string) => (zip[path] ? strFromU8(zip[path]) : null)
  const workbook = file('xl/workbook.xml')
  if (!workbook) throw new Error("This isn't an Excel workbook (.xlsx)")

  const strings = (() => {
    const t = file('xl/sharedStrings.xml')
    return t ? all(xml(t), 'si').map(text) : []
  })()

  const formats: string[] = []
  const styles = file('xl/styles.xml')
  if (styles) {
    const doc = xml(styles)
    const custom = new Map(all(doc, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']))
    const xfs = first(doc, 'cellXfs')
    for (const xf of xfs ? all(xfs, 'xf') : []) {
      const id = Number(xf.getAttribute('numFmtId') ?? 0)
      formats.push(dateFormats.has(id) ? (id >= 18 && id <= 21 ? 'h:mm' : id === 22 ? 'yyyy-mm-dd h:mm' : 'yyyy-mm-dd') : (custom.get(id) ?? (id === 9 ? '0%' : id === 10 ? '0.00%' : id === 2 ? '0.00' : id === 4 ? '#,##0.00' : id === 3 ? '#,##0' : '')))
    }
  }

  const rels = new Map<string, string>()
  const relText = file('xl/_rels/workbook.xml.rels')
  if (relText) for (const r of all(xml(relText), 'Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '')

  const sheets: Sheet[] = []
  all(xml(workbook), 'sheet').forEach((s, i) => {
    const id = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    const target = rels.get(id)
    const body = file(target ? resolveTarget(target) : `xl/worksheets/sheet${i + 1}.xml`)
    if (!body) return
    const doc = xml(body)
    const rows: (string | undefined)[][] = []
    const numeric = new Set<string>()
    let cols = 0
    for (const row of all(doc, 'row')) {
      const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1
      const cells: (string | undefined)[] = (rows[r] = [])
      let next = 0
      for (const c of all(row, 'c')) {
        const ref = c.getAttribute('r')
        const col = ref ? columnIndex(ref) : next
        next = col + 1
        const type = c.getAttribute('t')
        const v = first(c, 'v')?.textContent ?? ''
        let shown: string | undefined
        const formula = first(c, 'f')?.textContent
        if (v === '' && formula) shown = `=${formula}`
        else if (type === 's') shown = strings[Number(v)]
        else if (type === 'inlineStr') shown = text(first(c, 'is') ?? c)
        else if (type === 'b') shown = v === '1' ? 'TRUE' : 'FALSE'
        else if (type === 'str' || type === 'e') shown = v
        else if (v !== '') {
          const n = Number(v)
          const format = formats[Number(c.getAttribute('s') ?? 0)] ?? ''
          shown = Number.isNaN(n) ? v : isDateFormat(format) ? dateText(n, /h|s/i.test(format.replace(/"[^"]*"/g, ''))) : numberText(n, format)
          numeric.add(`${r}:${col}`)
        }
        if (shown !== undefined && shown !== '') {
          cells[col] = shown
          cols = Math.max(cols, col + 1)
        }
      }
    }
    const widths: (number | undefined)[] = []
    for (const c of all(doc, 'col')) {
      const min = Number(c.getAttribute('min')) - 1
      const max = Math.min(Number(c.getAttribute('max')) - 1, min + 1000)
      const w = Number(c.getAttribute('width'))
      if (w) for (let i = min; i <= max; i++) widths[i] = w
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= []
    sheets.push({ name: s.getAttribute('name') ?? `Sheet${i + 1}`, rows, cols, widths, numeric })
  })
  return sheets
}
