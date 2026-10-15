import React from 'react'
import './ui.css'

type Option = {
  value: string
  label: string
  // The stamp's own colours, as CSS values (tokens): its ink and its tint.
  fg: string
  bg: string
}

type Props = {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  disabled?: boolean
  // With a row label it is one row of a detail group ("Category").
  rowLabel?: string
}

/** The categories as a row of stamps. Every stamp is outlined in its own colour; only the chosen
 *  one is filled, so the choice reads at a glance and nothing needs a picker. */
export const StampSelect: React.FC<Props> = ({
  label,
  value,
  options,
  onChange,
  disabled,
  rowLabel,
}) => {
  const group = (
    <div className="ui-stampselect" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="ui-stampselect-btn"
          aria-pressed={o.value === value}
          disabled={disabled}
          style={{ '--stamp-fg': o.fg, '--stamp-bg': o.bg } as React.CSSProperties}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
  if (!rowLabel) return group
  return (
    <div className="ui-inline-row is-top">
      <span className="ui-navrow-label" aria-hidden>
        {rowLabel}
      </span>
      {group}
    </div>
  )
}
