import React, { useId, useRef, useState } from 'react'
import { Button } from 'antd'
import { Plus } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { parseQuickAdd } from '@lib/trips/schedule'
import { DEGRADED_TEXT, OSM_ATTRIBUTION, PlaceSlip, usePlaceSearch } from './places'

export type QuickAddItem = { title: string; start_time?: string; place?: Place }

type Props = {
  // Names the field: "Add to Sat 24", "Add an idea".
  label: string
  onAdd: (item: QuickAddItem) => void
  bias?: { lat: number; lng: number } | null
  // Where the new item goes: a day, or Ideas.
  targets: Array<{ value: string; label: string }>
  target: string
  onTarget: (v: string) => void
  inputId: string
}

// The one add control on a trip: the same pattern as the list page's add bar. Owns the draft
// so keystrokes re-render only this bar. "14:00 Pena Palace" sets the time; place suggestions
// rise as slips, like the pantry on a list.
export const AddBar: React.FC<Props> = ({
  label,
  onAdd,
  bias,
  targets,
  target,
  onTarget,
  inputId,
}) => {
  const [value, setValue] = useState('')
  const [active, setActive] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const [adds, setAdds] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  const uid = useId()
  const parsed = parseQuickAdd(value)
  const search = usePlaceSearch(parsed.title, bias)
  const fresh = search.forQuery === parsed.title.trim()
  const slips = fresh && !dismissed ? search.results : []
  const open = slips.length > 0
  const armed = parsed.title.length > 0

  const reset = () => {
    setValue('')
    setActive(-1)
    setDismissed(false)
    setAdds((n) => n + 1)
    requestAnimationFrame(() => ref.current?.focus())
  }
  const submit = () => {
    if (!parsed.title) return
    navigator.vibrate?.(8)
    onAdd({ title: parsed.title, start_time: parsed.start_time })
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
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Enter only takes a slip the user moved to; otherwise it adds what was typed.
      if (open && active >= 0) pick(slips[active])
      else submit()
    }
  }

  return (
    <div className="add-bar trip-addbar" role="region" aria-label="Add to trip">
      {open && (
        <div id={`${uid}-slips`} role="listbox" aria-label="Places" className="place-slips is-up">
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
        <select
          className="trip-target"
          aria-label="Add to"
          value={target}
          onChange={(e) => onTarget(e.target.value)}
        >
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="add-field trip-add-field">
          <input
            id={inputId}
            ref={ref}
            className="trip-add-input"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={open ? `${uid}-slips` : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${uid}-slip-${active}` : undefined}
            placeholder={label}
            value={value}
            enterKeyHint="enter"
            onChange={(e) => {
              setValue(e.target.value)
              setActive(-1)
              setDismissed(false)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(-1)}
          />
          {parsed.start_time && (
            <span className="add-qty-chip" aria-hidden>
              {parsed.start_time}
            </span>
          )}
        </div>
        <Button
          className={armed ? 'add-btn is-armed' : 'add-btn'}
          type="primary"
          shape="circle"
          size="large"
          aria-label={`${label}, add`}
          disabled={!armed}
          onClick={submit}
          icon={<Plus key={adds} className={adds ? 'add-plus is-turning' : 'add-plus'} />}
        />
      </div>
      <div className="trip-add-status" role="status">
        {fresh && search.degraded ? DEGRADED_TEXT : ''}
      </div>
    </div>
  )
}
