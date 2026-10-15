import React from 'react'
import './ui.css'

type Option<T extends string> = { value: T; label: string; icon?: React.ReactNode }

type Props<T extends string> = {
  // Names the group for screen readers ("Kind of booking").
  label: string
  value?: T
  options: Array<Option<T>>
  onChange: (v: T) => void
  // How many columns on a wide line; the group wraps by itself below that.
  columns?: number
  disabled?: boolean
}

/** The large choice chips: six booking kinds, seven category stamps. One is pressed. */
export function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  columns,
  disabled,
}: Props<T>) {
  return (
    <div
      className="ui-chipgroup"
      role="group"
      aria-label={label}
      style={columns ? ({ '--cols': columns } as React.CSSProperties) : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="ui-choice"
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon && (
            <span className="ui-choice-icon" aria-hidden>
              {o.icon}
            </span>
          )}
          <span className="ui-choice-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
