import { iconFor } from '../lib/fileIcons'

type Props = { n: { name: string; path: string; dir: boolean }; open?: boolean; root?: boolean }

export default function FileIcon({ n, open = false, root }: Props) {
  const src = iconFor(n.name, n.path, n.dir, open, root)
  return src ? <img className="ficon" src={src} alt="" draggable={false} /> : <span className="ficon" />
}
