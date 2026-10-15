import React from 'react'
import { CaretRight } from '@phosphor-icons/react'

export type DayRow = {
  value: string
  // "Thu 15 · Sintra"
  title: string
  // Muted: "All done", "Nothing planned".
  note?: string
  current?: boolean
}

type Props = {
  rows: DayRow[]
  onPick: (value: string) => void
  label: string
}

/** A simple list of days (or "Ideas"), styled like the House page's "Our Lists" rows. Used by
 *  the header's date line and by the add bar's day chip. */
export const DayList: React.FC<Props> = ({ rows, onPick, label }) => (
  <div className="lists-list trip-daylist">
    <ul className="ant-list-items" aria-label={label}>
      {rows.map((r) => (
        <li key={r.value} className="ant-list-item">
          <button
            type="button"
            className="list-row-link trip-dayrow"
            aria-current={r.current ? 'true' : undefined}
            onClick={() => onPick(r.value)}
          >
            <span className="list-row-text">
              <span className="list-row-name">{r.title}</span>
              {r.note && <span className="list-row-desc">{r.note}</span>}
            </span>
          </button>
          <CaretRight className="list-row-caret" size={18} weight="bold" aria-hidden />
        </li>
      ))}
    </ul>
  </div>
)
