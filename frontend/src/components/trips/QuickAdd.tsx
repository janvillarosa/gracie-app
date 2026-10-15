import React, { useId, useRef, useState } from 'react'
import { Button, Input, Popover } from 'antd'
import { ArrowsOutSimple, CaretDown, Plus } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { parseQuickAdd } from '@lib/trips/schedule'
import { titleProblem } from '@lib/trips/limits'
import { DayList } from './DayList'
import { DEGRADED_TEXT, OSM_ATTRIBUTION, PlaceSlip, usePlaceSearch } from './places'

export type QuickAddItem = { title: string; start_time?: string; place?: Place }

type Props = {
  // Names the field for screen readers: "Add to today", "Add an idea".
  label: string
  placeholder: string
  onAdd: (item: QuickAddItem) => void
  bias?: { lat: number; lng: number } | null
  // Where the new item goes, shown as a chip inside the field: a day, or Ideas.
  targets: Array<{ value: string; label: string }>
  target: string
  onTarget: (v: string) => void
  inputId: string
  // Opens the item editor, prefilled with what is typed. Offered once something is typed.
  onExpand?: (item: QuickAddItem) => void
  // 'booking': what is typed becomes the title of a new booking, which opens in its own sheet.
  mode?: 'todo' | 'booking'
  onLaunch?: (typed: string) => void
}

const MAX_SLIPS = 5

// The one add control on a trip, matching the list page's add bar: a field and a round yellow
// button. Owns the draft so keystrokes re-render only this bar. "14:00 Pena Palace" sets the
// time; place suggestions rise as slips, like the pantry on a list.
export const AddBar: React.FC<Props> = ({
  label,
  placeholder,
  onAdd,
  bias,
  targets,
  target,
  onTarget,
  inputId,
  onExpand,
  mode = 'todo',
  onLaunch,
}) => {
  const [value, setValue] = useState('')
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [adds, setAdds] = useState(0)
  const ref = useRef<{ focus: () => void } | null>(null)
  const uid = useId()
  const parsed = parseQuickAdd(value)
  const search = usePlaceSearch(mode === 'booking' ? '' : parsed.title, bias)
  const fresh = search.forQuery === parsed.title.trim()
  const slips = fresh && !dismissed ? search.results.slice(0, MAX_SLIPS) : []
  const open = slips.length > 0
  const problem = titleProblem(parsed.title)
  const armed = parsed.title.length > 0 && !problem
  const current = targets.find((t) => t.value === target)

  const reset = () => {
    setValue('')
    setActive(-1)
    setDismissed(false)
    setAdds((n) => n + 1)
    requestAnimationFrame(() => ref.current?.focus())
  }
  const submit = () => {
    if (!parsed.title || problem) return
    navigator.vibrate?.(8)
    onAdd({ title: parsed.title, start_time: parsed.start_time })
    reset()
  }
  // Booking mode: what is typed is the new booking's title (it is never dropped).
  const launch = () => {
    onLaunch?.(value.trim())
    reset()
  }
  const expand = () => {
    onExpand?.({ title: parsed.title, start_time: parsed.start_time })
    reset()
  }
  const pick = (p: Place) => {
    navigator.vibrate?.(8)
    onAdd({ title: p.name, start_time: parsed.start_time, place: p })
    reset()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (open && e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, slips.length - 1))
    } else if (open && e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (open && e.key === 'Escape') {
      e.preventDefault()
      setDismissed(true)
      setActive(-1)
    } else if (e.key === 'Enter' && e.shiftKey && mode === 'todo' && onExpand && armed) {
      e.preventDefault()
      expand()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (mode === 'booking') return launch()
      // Enter only takes a slip the user moved to; otherwise it adds what was typed.
      if (open && active >= 0) pick(slips[active])
      else submit()
    }
  }

  const [chipOpen, setChipOpen] = useState(false)

  return (
    <div className="add-bar" role="region" aria-label="Add to trip">
      {open && (
        <div id={`${uid}-slips`} role="listbox" aria-label="Places" className="pantry-slips">
          {slips.map((p, i) => (
            <PlaceSlip
              key={`${p.osm_ref ?? p.name}-${p.lat}-${p.lng}`}
              place={p}
              id={`${uid}-slip-${i}`}
              active={i === active}
              onPick={pick}
            />
          ))}
          <div className="place-attrib">{OSM_ATTRIBUTION}</div>
        </div>
      )}
      <div className="add-row">
        <div className={mode === 'todo' ? 'add-field trip-add-field has-target' : 'add-field'}>
          {mode === 'todo' && (
            <Popover
              trigger="click"
              placement="topLeft"
              open={chipOpen}
              onOpenChange={setChipOpen}
              overlayClassName="trip-gaps-pop trip-days-pop"
              content={
                <DayList
                  label="Add to"
                  rows={targets.map((t) => ({
                    value: t.value,
                    title: t.label,
                    current: t.value === target,
                  }))}
                  onPick={(v) => {
                    setChipOpen(false)
                    onTarget(v)
                  }}
                />
              }
            >
              <button
                type="button"
                className="trip-target-chip"
                aria-label={`Adding to ${current?.label ?? 'a day'}. Change where`}
              >
                {current?.label}
                <CaretDown aria-hidden />
              </button>
            </Popover>
          )}
          <Input.TextArea
            id={inputId}
            ref={ref as never}
            className="add-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setActive(-1)
              setDismissed(false)
            }}
            placeholder={placeholder}
            autoSize={{ minRows: 1, maxRows: 3 }}
            enterKeyHint="enter"
            onKeyDown={onKeyDown}
            onBlur={() => setActive(-1)}
            aria-label={label}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? `${uid}-slips` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${uid}-slip-${active}` : undefined}
          />
          {mode === 'todo' && parsed.start_time && (
            <span className="add-qty-chip" aria-hidden>
              {parsed.start_time}
            </span>
          )}
        </div>
        {mode === 'todo' && onExpand && armed && (
          <Button
            type="text"
            shape="circle"
            aria-label="Add with details"
            title="Add with details (Shift+Enter)"
            onClick={expand}
            icon={<ArrowsOutSimple />}
          />
        )}
        <Button
          className={armed || mode === 'booking' ? 'add-btn is-armed' : 'add-btn'}
          type="primary"
          shape="circle"
          size="large"
          aria-label={`${label}, add`}
          disabled={mode === 'todo' && !armed}
          onClick={mode === 'booking' ? launch : submit}
          icon={<Plus key={adds} className={adds ? 'add-plus is-turning' : 'add-plus'} />}
        />
      </div>
      <div className="trip-add-status" role="status">
        {problem || (fresh && search.degraded ? DEGRADED_TEXT : '')}
      </div>
    </div>
  )
}
