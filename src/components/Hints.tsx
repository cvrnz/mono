import { keyLabel } from '../lib/commands'

export default function Hints({ items }: { items: string[] }) {
  return (
    <div className="hints">
      <span className="hints-keys">{items.join('   ')}</span>
      <span className="hints-nav">{keyLabel('J')}/K next/previous pane</span>
    </div>
  )
}
