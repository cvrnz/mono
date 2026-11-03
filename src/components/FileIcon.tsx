import { iconFor, useIconPack } from '../lib/fileIcons'

type Props = { n: { name: string; path: string; dir: boolean }; open?: boolean }

export default function FileIcon({ n, open = false }: Props) {
  useIconPack()
  const src = iconFor(n.name, n.path, n.dir, open)
  return src ? <img className="ficon" src={src} alt="" draggable={false} /> : <span className="ficon" />
}
