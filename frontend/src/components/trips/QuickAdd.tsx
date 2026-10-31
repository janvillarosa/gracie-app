import React, { useLayoutEffect, useRef, useState } from 'react'
import {
  Button,
  Chip,
  Combobox,
  Field,
  PoweredBy,
  renderSuggestion,
  SEARCH_UNAVAILABLE,
  suggestionKey,
  suggestionLabel,
} from '@components/ui'
import { ArrowsOutSimple, Plus } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { parseQuickAdd } from '@lib/trips/schedule'
import { titleProblem } from '@lib/trips/limits'
import { DayPick } from './pickers'
import { usePlaceSuggest, useSuggestionPreview } from '@lib/trips/usePlaces'
import type { Suggestion } from '@lib/trips/placesSource'

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
  // A place suggestion is highlighted (or not): the map shows a hollow pin for it. Suggestions
  // carry no coordinates, so after a short dwell one `location` lookup finds them (cached).
  onPreview?: (place: Place | null) => void
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
  onPreview,
}) => {
  const [value, setValue] = useState('')
  const [adds, setAdds] = useState(0)
  const ref = useRef<{ focus: () => void } | null>(null)
  // The field's text starts just after the day chip, so the chip's width is measured, not guessed.
  const fieldBox = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = fieldBox.current
    const chip = box?.querySelector<HTMLElement>('.trip-target-chip')
    if (!box || !chip) return
    const set = () =>
      box.style.setProperty('--chip-w', `${Math.ceil(chip.getBoundingClientRect().width)}px`)
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(chip)
    return () => ro.disconnect()
  })
  const parsed = parseQuickAdd(value)
  const search = usePlaceSuggest(mode === 'booking' ? '' : parsed.title, bias)
  const fresh = search.forQuery === parsed.title.trim()
  // A degraded search offers no slips (just the status line below).
  const slips = fresh && !search.degraded ? search.suggestions.slice(0, MAX_SLIPS) : []
  const problem = titleProblem(parsed.title)
  const armed = parsed.title.length > 0 && !problem
  const current = targets.find((t) => t.value === target)

  const highlight = useSuggestionPreview(onPreview)

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
  // A pick stores only the Google place (id, coordinates, fetch time). The title is what was
  // typed: the person's words, never Google's name, which can come back in another language.
  const pick = async (s: Suggestion) => {
    const place = await search.pick(s)
    if (!place) return
    navigator.vibrate?.(8)
    onAdd({ title: parsed.title.trim(), start_time: parsed.start_time, place })
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
    const border = el.offsetHeight - el.clientHeight // the 1px frame that matches the List bar
    el.style.height = `${Math.min(el.scrollHeight + border, 22 * 3 + 20 + border)}px`
  }

  return (
    <div className="add-bar" role="region" aria-label="Add to trip">
      <Combobox
        options={slips}
        getKey={suggestionKey}
        getLabel={suggestionLabel}
        renderOption={renderSuggestion}
        onPick={pick}
        onSubmitText={mode === 'booking' ? launch : submit}
        query={value}
        onKeyDown={onKeyDown}
        onHighlight={onPreview ? highlight : undefined}
        footer={<PoweredBy source={search.attribution} />}
        listLabel="Places"
      >
        {({ input }) => (
          <div className="add-row">
            <div
              ref={fieldBox}
              className={mode === 'todo' ? 'add-field trip-add-field has-target' : 'add-field'}
            >
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
              icon={
                <Plus
                  key={adds}
                  weight="bold"
                  className={adds ? 'add-plus is-turning' : 'add-plus'}
                />
              }
            />
          </div>
        )}
      </Combobox>
      <div className="trip-add-status" role="status">
        {problem || (fresh && search.degraded ? SEARCH_UNAVAILABLE : '')}
      </div>
    </div>
  )
}
