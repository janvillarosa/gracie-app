import React, { useEffect, useRef, useState } from 'react'
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
  // What is wrong with a value ('' when nothing): defaults to the trip title limit.
  validate?: (v: string) => string
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
  validate = titleProblem,
}) => {
  const [problem, setProblem] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // A new item opens with its title ready to type: focus it without scrolling anything.
  useEffect(() => {
    if (!autoFocus) return
    field.current?.focus({ preventScroll: true })
    field.current?.select()
  }, [autoFocus])
  if (!onCommit) return <h2 className="ui-sheet-title">{value}</h2>
  return (
    <Field
      key={value}
      ref={field as never}
      className="ui-sheet-title"
      aria-label={label}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      error={problem}
      onChange={(e) => setProblem(validate(e.target.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      onBlur={(e) => {
        const v = e.target.value.trim()
        if (!v) {
          e.target.value = value
          setProblem('')
        } else if (validate(v)) setProblem(validate(v))
        else if (v !== value) onCommit(v)
      }}
    />
  )
}
