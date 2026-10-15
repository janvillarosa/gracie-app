import React, { useState } from 'react'
import { titleProblem } from '@lib/trips/limits'
import { Field } from './Field'
import './ui.css'

type Props = {
  value: string
  // Present: the title is an inline-editable field that saves on blur or Enter. Absent: a heading.
  onCommit?: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
  placeholder?: string
  // The accessible name of the field.
  label?: string
}

/** The large heading of a sheet (Outfit 26/700): inline-editable where it makes sense, with the
 *  server's title limit said where you type. */
export const SheetTitle: React.FC<Props> = ({
  value,
  onCommit,
  autoFocus,
  disabled,
  placeholder,
  label = 'Title',
}) => {
  const [problem, setProblem] = useState('')
  if (!onCommit) return <h2 className="ui-sheet-title">{value}</h2>
  return (
    <Field
      key={value}
      className="ui-sheet-title"
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      error={problem}
      // biome-ignore lint/a11y/noAutofocus: a new item opens with its title ready to type
      autoFocus={autoFocus}
      onFocus={(e) => autoFocus && e.target.select()}
      onChange={(e) => setProblem(titleProblem(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      onBlur={(e) => {
        const v = e.target.value.trim()
        if (!v) {
          e.target.value = value
          setProblem('')
        } else if (titleProblem(v)) setProblem(titleProblem(v))
        else if (v !== value) onCommit(v)
      }}
    />
  )
}
