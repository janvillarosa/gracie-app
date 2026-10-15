import React, { useEffect, useRef, useState } from 'react'
import { Popover } from 'antd'
import { CaretDown } from '@phosphor-icons/react'
import type { TripCategory } from '@api/tripTypes'
import { shortDay } from '@lib/trips/schedule'
import { DayList } from './DayList'
import type { MoveTarget } from './MoveMenu'
import { useMedia } from './Phone'
import { Sheet } from './Sheet'
import { CATEGORIES, categoryLabel } from './tripUi'

type ChipProps = {
  // Names the chip for screen readers: "Day", "Time", "Length", "Category".
  label: string
  // Its value in words, for the accessible name ("Day, Thu 15").
  text: string
  display?: React.ReactNode
  title: string
  muted?: boolean
  disabled?: boolean
  autoFocus?: boolean
  children: (close: () => void) => React.ReactNode
}

/** A real chip: a button that opens a small popover (wide screens) or a sheet (elsewhere).
 *  The same control for day, time, length and kind, so there are no native pickers to restyle. */
export const ChipPicker: React.FC<ChipProps> = ({
  label,
  text,
  display,
  title,
  muted,
  disabled,
  autoFocus,
  children,
}) => {
  const [open, setOpen] = useState(false)
  const desktop = useMedia('(min-width: 1024px)')
  // Esc closes the chip's popover, and only that (not the panel it sits in).
  useEffect(() => {
    if (!open || !desktop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, desktop])
  const close = () => setOpen(false)
  const button = (
    <button
      type="button"
      className={muted ? 'trip-chip is-add' : 'trip-chip'}
      disabled={disabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${label}, ${text}`}
      // biome-ignore lint/a11y/noAutofocus: opened from an overlap line to change this time
      autoFocus={autoFocus}
      onClick={desktop ? undefined : () => setOpen(true)}
    >
      {display ?? text}
      <CaretDown aria-hidden />
    </button>
  )
  if (desktop) {
    return (
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        overlayClassName="trip-gaps-pop trip-chip-pop"
        destroyTooltipOnHide
        content={children(close)}
      >
        {button}
      </Popover>
    )
  }
  return (
    <>
      {button}
      <Sheet title={title} open={open} onClose={close}>
        <div className="trip-sheet-pad">{open ? children(close) : null}</div>
      </Sheet>
    </>
  )
}

type Option = { value: string; label: string }

const PickList: React.FC<{
  label: string
  options: Option[]
  value: string
  onPick: (v: string) => void
}> = ({ label, options, value, onPick }) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'center' })
  }, [])
  return (
    <div ref={ref} className="trip-pick trip-pick-scroll" role="listbox" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="option"
          aria-selected={o.value === value}
          className="trip-pick-row"
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---- day ----------------------------------------------------------------------------------
const IDEAS = '__ideas__'

export const DayChip: React.FC<{
  value: string | null
  days: MoveTarget[]
  // Todos can sit in Ideas (no day); a booking cannot.
  allowIdeas?: boolean
  placeholder?: string
  disabled?: boolean
  onPick: (day: string | null) => void
}> = ({ value, days, allowIdeas, placeholder = 'Add a day', disabled, onPick }) => {
  const real = days.filter((d) => d.value !== null)
  const rows = [
    ...real.map((d) => ({ value: d.value as string, title: d.label, current: d.value === value })),
    ...(value && !real.some((d) => d.value === value)
      ? [{ value, title: shortDay(value), current: true }]
      : []),
    ...(allowIdeas ? [{ value: IDEAS, title: 'Ideas', current: value === null }] : []),
  ]
  const text = value ? shortDay(value) : allowIdeas ? 'Ideas' : placeholder
  return (
    <ChipPicker
      label="Day"
      text={text}
      muted={!value && !allowIdeas}
      title="Day"
      disabled={disabled}
    >
      {(close) => (
        <DayList
          label="Pick a day"
          rows={rows}
          onPick={(v) => {
            close()
            onPick(v === IDEAS ? null : v)
          }}
        />
      )}
    </ChipPicker>
  )
}

// ---- time ---------------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0')
const STEPS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)
const NONE = ''

/** Times read as 24-hour wall-clock everywhere in the app. */
export const TimeChip: React.FC<{
  value: string | null
  // A todo's time can be cleared; a booking's cannot.
  clearable?: boolean
  label?: string
  // The zone the time is in, only when it is not the trip's ("London").
  suffix?: string
  disabled?: boolean
  autoFocus?: boolean
  onPick: (time: string | null) => void
}> = ({ value, clearable, label = 'Time', suffix, disabled, autoFocus, onPick }) => {
  const have = value ?? NONE
  const options: Option[] = [
    ...(clearable ? [{ value: NONE, label: 'No time' }] : []),
    ...(have && !STEPS.includes(have) ? [{ value: have, label: have }] : []),
    ...STEPS.map((t) => ({ value: t, label: t })),
  ].sort((a, b) => (a.value === NONE ? -1 : b.value === NONE ? 1 : a.value < b.value ? -1 : 1))
  return (
    <ChipPicker
      label={label}
      text={value ? `${value}${suffix ? ` ${suffix}` : ''}` : 'not set'}
      display={
        value ? (
          <>
            {value}
            {suffix && <span className="trip-chip-zone"> {suffix}</span>}
          </>
        ) : (
          '+ Time'
        )
      }
      muted={!value}
      title={label}
      disabled={disabled}
      autoFocus={autoFocus}
    >
      {(close) => (
        <PickList
          label={`${label} options`}
          options={options}
          value={have}
          onPick={(v) => {
            close()
            if (v !== have) onPick(v || null)
          }}
        />
      )}
    </ChipPicker>
  )
}

// ---- length -------------------------------------------------------------------------------
const DURATIONS: Option[] = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 h' },
  { value: '120', label: '2 h' },
  { value: '240', label: 'Half day' },
]
const CUSTOM = 'custom'
const NO_LENGTH = ''

const lengthText = (min?: number | null) =>
  !min ? '' : (DURATIONS.find((d) => d.value === String(min))?.label ?? `${min} min`)

const CustomLength: React.FC<{ value?: number | null; onSet: (n: number | null) => void }> = ({
  value,
  onSet,
}) => (
  <form
    className="trip-custom-length"
    onSubmit={(e) => {
      e.preventDefault()
      const v = (e.currentTarget.elements.namedItem('minutes') as HTMLInputElement).value
      const n = v ? Number(v) : null
      if (n === null || (n >= 1 && n <= 1440)) onSet(n)
    }}
  >
    <input
      name="minutes"
      className="trip-chip"
      type="number"
      min={1}
      max={1440}
      inputMode="numeric"
      aria-label="Duration in minutes"
      defaultValue={value ?? ''}
      // biome-ignore lint/a11y/noAutofocus: the field opens because "Custom" was chosen
      autoFocus
    />
    <button type="submit" className="trip-chip">
      Set
    </button>
  </form>
)

const LengthPick: React.FC<{
  value?: number | null
  close: () => void
  onPick: (min: number | null) => void
}> = ({ value, close, onPick }) => {
  const [custom, setCustom] = useState(false)
  const options: Option[] = [
    { value: NO_LENGTH, label: 'No length' },
    ...DURATIONS,
    { value: CUSTOM, label: 'Custom' },
  ]
  if (custom)
    return (
      <CustomLength
        value={value}
        onSet={(n) => {
          close()
          onPick(n)
        }}
      />
    )
  const current = value
    ? DURATIONS.some((d) => d.value === String(value))
      ? String(value)
      : CUSTOM
    : NO_LENGTH
  return (
    <PickList
      label="Length options"
      options={options}
      value={current}
      onPick={(v) => {
        if (v === CUSTOM) return setCustom(true)
        close()
        onPick(v ? Number(v) : null)
      }}
    />
  )
}

export const LengthChip: React.FC<{
  value?: number | null
  disabled?: boolean
  onPick: (min: number | null) => void
}> = ({ value, disabled, onPick }) => {
  const shown = lengthText(value)
  return (
    <ChipPicker
      label="Length"
      text={shown || 'not set'}
      display={shown || '+ Length'}
      muted={!shown}
      title="Length"
      disabled={disabled}
    >
      {(close) => <LengthPick value={value} close={close} onPick={onPick} />}
    </ChipPicker>
  )
}

// ---- kind ---------------------------------------------------------------------------------
/** Only the chosen stamp shows; the seven live behind it. */
export const StampChip: React.FC<{
  value: TripCategory
  disabled?: boolean
  onPick: (c: TripCategory) => void
}> = ({ value, disabled, onPick }) => (
  <ChipPicker
    label="Category"
    text={categoryLabel(value)}
    display={
      <span className={`category-tag trip-cat trip-cat-${value} trip-stamp-btn is-on`}>
        {categoryLabel(value)}
      </span>
    }
    title="Category"
    disabled={disabled}
  >
    {(close) => (
      <div className="trip-sheet-stamps" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={value === c.value}
            aria-label={`Category: ${c.label}`}
            className={`category-tag trip-cat trip-cat-${c.value} trip-stamp-btn${value === c.value ? ' is-on' : ''}`}
            onClick={() => {
              close()
              onPick(c.value)
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    )}
  </ChipPicker>
)
