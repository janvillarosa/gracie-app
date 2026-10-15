import React, { useRef, useState } from 'react'
import { Button, Chip, Combobox, Field } from '@components/ui'
import { ArrowsOutSimple, Plus } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { parseQuickAdd } from '@lib/trips/schedule'
import { titleProblem } from '@lib/trips/limits'
import { DayPick } from './pickers'
import { DEGRADED_TEXT, OSM_ATTRIBUTION, usePlaceSearch } from './places'

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
  // A place suggestion is highlighted (or not): the map shows a hollow pin for it.
  onPreview?: (place: Place | null) => void
}

const MAX_SLIPS = 5

const placeKey = (p: Place) => `${p.osm_ref ?? p.name}-${p.lat}-${p.lng}`
const placeDetail = (p: Place) => p.address || p.locality || ''
const placeLabel = (p: Place) => {
  const detail = placeDetail(p)
  return detail ? `${p.name}, ${detail}` : p.name
}
const renderPlace = (p: Place) => {
  const detail = placeDetail(p)
  return (
    <>
      <span className="slip-name">{p.name}</span>
      {detail && <span className="slip-usual">{detail}</span>}
    </>
  )
}

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
  onPreview,
}) => {
  const [value, setValue] = useState('')
  const [adds, setAdds] = useState(0)
  const ref = useRef<{ focus: () => void } | null>(null)
  const parsed = parseQuickAdd(value)
  const search = usePlaceSearch(mode === 'booking' ? '' : parsed.title, bias)
  const fresh = search.forQuery === parsed.title.trim()
  // A degraded search offers no slips (just the status line below).
  const slips = fresh && !search.degraded ? search.results.slice(0, MAX_SLIPS) : []
  const problem = titleProblem(parsed.title)
  const armed = parsed.title.length > 0 && !problem
  const current = targets.find((t) => t.value === target)

  const reset = () => {
    setValue('')
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
  // Shift+Enter opens the full editor; the combobox handles every other key.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey && mode === 'todo' && onExpand && armed) {
      e.preventDefault()
      expand()
      return true
    }
    return false
  }

  // One line, growing to three as you type.
  const grow = (el: HTMLTextAreaElement | HTMLInputElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 22 * 3 + 20)}px`
  }

  return (
    <div className="add-bar" role="region" aria-label="Add to trip">
      <Combobox
        options={slips}
        getKey={placeKey}
        getLabel={placeLabel}
        renderOption={renderPlace}
        onPick={pick}
        onSubmitText={mode === 'booking' ? launch : submit}
        query={value}
        onKeyDown={onKeyDown}
        // The highlighted suggestion previews on the map; nothing highlighted clears it.
        onHighlight={onPreview}
        footer={<div className="place-attrib">{OSM_ATTRIBUTION}</div>}
        listLabel="Places"
      >
        {({ input }) => (
          <div className="add-row">
            <div className={mode === 'todo' ? 'add-field trip-add-field has-target' : 'add-field'}>
              {mode === 'todo' && (
                <Chip
                  label="Adding to"
                  value={current?.label ?? 'a day'}
                  title="Add to"
                  className="trip-target-chip"
                >
                  {(close) => (
                    <DayPick
                      days={targets
                        .filter((t) => t.value !== 'ideas')
                        .map((t) => ({ value: t.value as string | null, label: t.label }))}
                      value={target === 'ideas' ? null : target}
                      allowIdeas={targets.some((t) => t.value === 'ideas')}
                      onPick={(d) => {
                        close()
                        onTarget(d === null ? 'ideas' : d)
                      }}
                    />
                  )}
                </Chip>
              )}
              <Field
                multiline
                id={inputId}
                ref={ref as never}
                className="add-input"
                value={value}
                rows={1}
                onChange={(e) => {
                  setValue(e.target.value)
                  grow(e.target)
                }}
                placeholder={placeholder}
                enterKeyHint="enter"
                aria-label={label}
                {...input}
              />
              {mode === 'todo' && parsed.start_time && (
                <span className="add-qty-chip" aria-hidden>
                  {parsed.start_time}
                </span>
              )}
            </div>
            {mode === 'todo' && onExpand && armed && (
              <Button
                kind="text"
                iconOnly
                aria-label="Add with details"
                title="Add with details (Shift+Enter)"
                onClick={expand}
                icon={<ArrowsOutSimple />}
              />
            )}
            <Button
              kind="key"
              iconOnly
              className={armed || mode === 'booking' ? 'add-btn is-armed' : 'add-btn'}
              aria-label={`${label}, add`}
              disabled={mode === 'todo' && !armed}
              onClick={mode === 'booking' ? launch : submit}
              icon={<Plus key={adds} className={adds ? 'add-plus is-turning' : 'add-plus'} />}
            />
          </div>
        )}
      </Combobox>
      <div className="trip-add-status" role="status">
        {problem || (fresh && search.degraded ? DEGRADED_TEXT : '')}
      </div>
    </div>
  )
}
