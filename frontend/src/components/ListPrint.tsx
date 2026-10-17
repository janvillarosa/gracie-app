import type React from 'react'
import { useMemo } from 'react'
import type { ListItem } from '@api/types'
import { PrintOnly, PrintSheet } from '@components/ui'
import { dateWithYear, localDateKey } from '@lib/trips/schedule'

type Props = { name: string; items: ListItem[]; house?: string }

const label = (it: ListItem) =>
  [[it.quantity, it.unit].filter(Boolean).join(' '), it.description].filter(Boolean).join(' ')

const ListPaper: React.FC<Props> = ({ name, items, house }) => {
  const groups = useMemo(() => {
    const out = new Map<string, ListItem[]>()
    const open = items
      .filter((it) => !it.completed && !it.is_archived)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
    for (const it of open) {
      const cat = it.category || 'Uncategorized'
      out.set(cat, [...(out.get(cat) ?? []), it])
    }
    return [...out.entries()]
  }, [items])
  const count = groups.reduce((n, [, its]) => n + its.length, 0)
  const meta = [
    count === 0 ? 'Nothing left to get' : `${count} to get`,
    house,
    `Printed ${dateWithYear(localDateKey())}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <PrintSheet kicker="List" title={name} meta={meta}>
      {groups.map(([cat, its]) => (
        <section key={cat} className="print-group">
          <h2 className="print-group-title">{cat}</h2>
          <ul className="print-checks">
            {its.map((it) => (
              <li key={it.item_id}>{label(it)}</li>
            ))}
          </ul>
        </section>
      ))}
    </PrintSheet>
  )
}

/** A list on paper: what is still to get, by category, each with a box to tick by hand. Checked
 *  items stay off the page. */
export const ListPrint: React.FC<Props> = (props) => (
  <PrintOnly>
    <ListPaper {...props} />
  </PrintOnly>
)
