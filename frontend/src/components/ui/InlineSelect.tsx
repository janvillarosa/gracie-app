import React from 'react'
import { CaretDown } from '@phosphor-icons/react'
import './ui.css'

type Option = { value: string; label: string }

type Props = {
  // Names the select for screen readers ("Day", "Linked booking").
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  // With a row label ("Booking") it is one row of a detail group: the label on the left, the
  // select filling the rest. Without it, the bare select (inside another row).
  rowLabel?: string
  className?: string
}

/** A native select drawn like the rest of the paper: no popover to open, the platform's own list,
 *  the keyboard for free. The desktop inspector uses it where a phone would open a picker. */
export const InlineSelect: React.FC<Props> = ({
  label,
  value,
  options,
  onChange,
  disabled,
  rowLabel,
  className,
}) => {
  const control = (
    <span className={['ui-select', className ?? ''].filter(Boolean).join(' ')}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown aria-hidden className="ui-select-caret" />
    </span>
  )
  if (!rowLabel) return control
  return (
    <div className="ui-inline-row">
      <span className="ui-navrow-label" aria-hidden>
        {rowLabel}
      </span>
      {control}
    </div>
  )
}
