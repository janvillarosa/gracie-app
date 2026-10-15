import React from 'react'
import { Checkbox } from 'antd'
import type { Booking, TripCategory, TripTodo } from '@api/tripTypes'
import { LIMITS } from '@lib/trips/limits'
import { hasPin, todoTitle } from '@lib/trips/places'
import { endClock, mapsUrl, shortDay } from '@lib/trips/schedule'
import {
  Button,
  DetailGroup,
  InlinePlace,
  InlineSelect,
  InlineWhen,
  NavRow,
  Sheet,
  SheetActions,
  SheetFooter,
  SheetIdentity,
  Stamp,
  StampSelect,
} from '@components/ui'
import { CodeReveal } from './CodeReveal'
import type { MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { placeFromTyped } from './typedPlace'
import { BookingPick, CategoryPick, NotePick, WhenPick, lengthText } from './pickers'
import { CATEGORIES, categoryLabel } from './tripUi'

type Bias = { lat: number; lng: number } | null

type Props = {
  // panel: docked over the map (wide screens). sheet: everywhere else.
  variant: 'panel' | 'sheet'
  open: boolean
  onClose: () => void
  todo: TripTodo
  bookings: Booking[]
  days: MoveTarget[]
  tripTz?: string
  bias: Bias
  byline: string
  locked: boolean
  // Just created from the add bar or the map: the title is ready to type over.
  fresh?: boolean
  // Opened from an overlap line: the When picker starts open.
  focusTime?: boolean
  onPatch: (patch: Record<string, unknown>) => void
  onMove: (day: string | null) => void
  onDelete: () => void
  onCopy: (code: string) => void
}

/** A todo, in the four tiers: identity (checkbox, title, one context line), do (Open Maps, Show
 *  code), details (When, Place, Category, Booking, Note) and a footer. It saves as it changes. */
export const TodoSheet: React.FC<Props> = ({
  variant,
  open,
  onClose,
  todo,
  bookings,
  days,
  tripTz,
  bias,
  byline,
  locked,
  fresh,
  focusTime,
  onPatch,
  onMove,
  onDelete,
  onCopy,
}) => {
  // The desktop inspector edits in place (no picker sheets); the phone sheet opens pickers.
  const inline = variant === 'panel'
  const pin = hasPin(todo.place) ? todo.place : null
  const linked = bookings.find((b) => b.booking_id === todo.booking_id)
  const end = todo.start_time ? endClock(todo.start_time, todo.duration_min) : ''
  const when = [
    todo.day ? shortDay(todo.day) : 'Ideas',
    todo.start_time ? `${todo.start_time}${end ? `–${end}` : ''}` : '',
    todo.place?.locality ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  // A place named like the item says only where it is: "Sintra", not the name twice.
  const sameName =
    !!todo.place &&
    (todo.place.name ?? '').trim().toLowerCase() === (todo.title ?? '').trim().toLowerCase()
  const placeText = todo.place
    ? sameName
      ? (todo.place.locality ?? todo.place.name)
      : [todo.place.name, todo.place.locality]
          .filter((x, i, a) => x && a.indexOf(x) === i)
          .join(' · ')
    : ''
  const whenText = [
    todo.day ? shortDay(todo.day) : 'Ideas',
    todo.start_time ? `, ${todo.start_time}` : '',
    todo.duration_min && todo.start_time ? ` · ${lengthText(todo.duration_min)}` : '',
  ].join('')

  return (
    <Sheet
      variant={variant}
      open={open}
      onClose={onClose}
      label={todoTitle(todo)}
      identity={
        <SheetIdentity
          leading={
            <span className="trip-check">
              <Checkbox
                checked={todo.done}
                disabled={locked}
                onChange={(e) => onPatch({ done: e.target.checked })}
                aria-label={`${todoTitle(todo)}, done`}
              />
            </span>
          }
          title={todo.title}
          onTitle={(v) => onPatch({ title: v })}
          autoFocus={fresh}
          disabled={locked}
          // A blank title on a Google place reads as the place's name, as the row does.
          placeholder={todo.place?.name || 'Name this'}
          context={when}
        >
          <Stamp category={todo.category}>{categoryLabel(todo.category)}</Stamp>
        </SheetIdentity>
      }
      actions={
        pin || linked?.confirmation_code ? (
          <SheetActions>
            {pin && (
              <Button
                kind="key"
                href={mapsUrl(pin.lat, pin.lng, pin.place_id)}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open Maps
              </Button>
            )}
            {linked?.confirmation_code && (
              <CodeReveal
                code={linked.confirmation_code}
                title={linked.title}
                kind={linked.kind}
                line={[linked.starts_at?.split('T')[1], linked.place?.name]
                  .filter(Boolean)
                  .join(' · ')}
                onCopy={onCopy}
              />
            )}
          </SheetActions>
        ) : undefined
      }
      details={
        <DetailGroup label="Details">
          {inline ? (
            <InlineWhen
              days={days}
              day={todo.day ?? null}
              time={todo.start_time ?? null}
              length={todo.duration_min}
              allowIdeas
              withLength
              clearableTime
              disabled={locked}
              autoFocusTime={focusTime}
              onDay={onMove}
              onTime={(t) => onPatch({ start_time: t })}
              onLength={(n) => onPatch({ duration_min: n })}
            />
          ) : (
            <NavRow
              label="When"
              value={whenText}
              disabled={locked}
              defaultOpen={focusTime}
              picker={{
                title: 'When',
                content: () => (
                  <WhenPick
                    days={days}
                    day={todo.day ?? null}
                    time={todo.start_time ?? null}
                    length={todo.duration_min}
                    allowIdeas
                    withLength
                    clearableTime
                    onDay={onMove}
                    onTime={(t) => onPatch({ start_time: t })}
                    onLength={(n) => onPatch({ duration_min: n })}
                  />
                ),
              }}
            />
          )}
          {inline ? (
            <div className="ui-inline-row is-top">
              <span className="ui-navrow-label" aria-hidden>
                Place
              </span>
              <InlinePlace
                label="Place"
                value={todo.place}
                bias={bias}
                onChange={(p) => onPatch({ place: p })}
                onText={(t) => onPatch({ place: placeFromTyped(t, bias, tripTz) })}
              />
            </div>
          ) : (
            <NavRow
              label="Place"
              value={placeText || 'Add a place'}
              empty={!placeText}
              disabled={locked}
              picker={{
                title: 'Place',
                content: (close) => (
                  <PlacePicker
                    label="Place"
                    value={todo.place}
                    bias={bias}
                    tz={tripTz}
                    onChange={(p) => {
                      onPatch({ place: p })
                      if (p) close()
                    }}
                  />
                ),
              }}
            />
          )}
          {inline ? (
            <StampSelect
              rowLabel="Category"
              label="Category"
              value={todo.category}
              disabled={locked}
              options={CATEGORIES.map((c) => ({
                value: c.value,
                label: c.label,
                fg: `var(--trip-cat-${c.value}-fg)`,
                bg: `var(--trip-cat-${c.value}-bg)`,
              }))}
              onChange={(c) => onPatch({ category: c as TripCategory })}
            />
          ) : (
            <NavRow
              label="Category"
              value={categoryLabel(todo.category)}
              disabled={locked}
              picker={{
                title: 'Category',
                content: (close) => (
                  <CategoryPick
                    value={todo.category}
                    onPick={(c: TripCategory) => {
                      onPatch({ category: c })
                      close()
                    }}
                  />
                ),
              }}
            />
          )}
          {(bookings.length > 0 || linked) && inline && (
            <InlineSelect
              rowLabel="Booking"
              label="Linked booking"
              value={todo.booking_id ?? ''}
              disabled={locked}
              options={[
                { value: '', label: 'None' },
                ...bookings.map((b) => ({ value: b.booking_id, label: b.title })),
              ]}
              onChange={(id) => onPatch({ booking_id: id || null })}
            />
          )}
          {(bookings.length > 0 || linked) && !inline && (
            <NavRow
              label="Booking"
              value={linked ? linked.title : 'None'}
              empty={!linked}
              disabled={locked}
              picker={{
                title: 'Linked booking',
                content: (close) => (
                  <BookingPick
                    bookings={bookings}
                    value={todo.booking_id}
                    onPick={(id) => {
                      onPatch({ booking_id: id })
                      close()
                    }}
                  />
                ),
              }}
            />
          )}
          {inline ? (
            <div className="ui-inline-note">
              <NotePick
                value={todo.notes ?? ''}
                max={LIMITS.itemNotesBytes}
                autoFocus={false}
                onCommit={(v) => onPatch({ notes: v })}
              />
            </div>
          ) : (
            <NavRow
              label="Note"
              value={todo.notes ? todo.notes.split('\n')[0] : 'Add a note'}
              empty={!todo.notes}
              disabled={locked}
              picker={{
                title: 'Note',
                content: () => (
                  <NotePick
                    value={todo.notes ?? ''}
                    max={LIMITS.itemNotesBytes}
                    onCommit={(v) => onPatch({ notes: v })}
                  />
                ),
              }}
            />
          )}
        </DetailGroup>
      }
      footer={<SheetFooter who={byline} onDelete={locked ? undefined : onDelete} />}
    />
  )
}
