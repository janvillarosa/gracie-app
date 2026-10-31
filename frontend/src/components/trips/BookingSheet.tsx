import React, { useState } from 'react'
import { Dropdown } from 'antd'
import { DotsThree } from '@phosphor-icons/react'
import type { Booking, BookingKind, Place } from '@api/tripTypes'
import {
  bookingEndMs,
  bookingStartMs,
  bookingRoute,
  bookingSub,
  inferKind,
  joinDt,
  normalizeZone,
  splitDt,
} from '@lib/trips/bookings'
import { LIMITS } from '@lib/trips/limits'
import { hasPin, type LatLng, placeText } from '@lib/trips/places'
import { addDays, mapsUrl, shortDay, zoneLabel } from '@lib/trips/schedule'
import {
  Button,
  DetailGroup,
  Field,
  InlinePlace,
  InlineWhen,
  NavRow,
  Sheet,
  SheetActions,
  SheetFooter,
  SheetIdentity,
} from '@components/ui'
import { CodeReveal } from './CodeReveal'
import type { MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { placeFromTyped } from './typedPlace'
import { KindPick, NotePick, WhenPick } from './pickers'
import { BOOKING_KINDS, KIND_ICON } from './tripUi'

type Bias = { lat: number; lng: number } | null

type Props = {
  mode: 'new' | 'edit'
  variant: 'panel' | 'sheet'
  open: boolean
  onClose: () => void
  booking?: Booking
  // New: what was typed in the add bar. It is the title; a kind is guessed from it.
  initialTitle?: string
  tripTz?: string
  bias: Bias
  // The points of this item's day, where place searches lean (a day can span cities).
  near?: LatLng[]
  days: MoveTarget[]
  // A new booking starts here (a datetime-local value).
  defaultStart?: string
  // For the state line ("Now · until Sun 18, 11:00").
  nowMs: number
  // Edit: the todos linked to this booking, as a muted line.
  linked?: Array<{ id: string; title: string }>
  byline?: string
  note?: string
  onDismissNote?: () => void
  locked?: boolean
  focusTime?: boolean
  onSave: (id: string | null, patch: Record<string, unknown>) => void
  onDelete?: () => void
  onCopy: (code: string) => void
  onOpenTodo?: (todoId: string) => void
  // New: whether anything was entered, so closing can ask before discarding.
  onDirty?: (dirty: boolean) => void
}

type Draft = Partial<Booking>

/** Which rows a kind shows, and what its places and times are called. */
const KIND_ROWS: Record<
  BookingKind,
  {
    place: string
    // The second place ("To"), for the kinds that go from one place to another.
    endPlace?: string
    start: string
    end: string
    hasEnd: boolean
    arrives: boolean
  }
> = {
  flight: {
    place: 'From',
    endPlace: 'To',
    start: 'Depart',
    end: 'Arrive',
    hasEnd: true,
    arrives: true,
  },
  train: {
    place: 'From',
    endPlace: 'To',
    start: 'Depart',
    end: 'Arrive',
    hasEnd: true,
    arrives: true,
  },
  stay: { place: 'Place', start: 'Check-in', end: 'Check-out', hasEnd: true, arrives: false },
  car: {
    place: 'From',
    endPlace: 'To',
    start: 'Pick-up',
    end: 'Drop-off',
    hasEnd: true,
    arrives: false,
  },
  ticket: { place: 'Place', start: 'When', end: '', hasEnd: false, arrives: false },
  other: { place: 'Place', start: 'When', end: '', hasEnd: false, arrives: false },
}

const mask = (code: string) => `•••• ${code.slice(-3)}`

/** A booking, in the four tiers: identity (kind tile, title, its state), do (Open Maps, Show
 *  code; or Add booking while it is new), details (kind-dependent rows), a footer. A new one
 *  starts with the kind; an existing one saves as it changes. */
export const BookingSheet: React.FC<Props> = ({
  mode,
  variant,
  open,
  onClose,
  booking,
  initialTitle = '',
  tripTz,
  bias,
  near,
  days,
  defaultStart,
  nowMs,
  linked,
  byline,
  note,
  onDismissNote,
  locked,
  focusTime,
  onSave,
  onDelete,
  onCopy,
  onOpenTodo,
  onDirty,
}) => {
  const [draft, setDraft] = useState<Draft>(() => ({
    kind: inferKind(initialTitle),
    title: initialTitle,
    starts_at: defaultStart ?? null,
  }))
  const [zonesOpen, setZonesOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [kindOpen, setKindOpen] = useState(false)
  const isNew = mode === 'new'
  // The desktop inspector edits in place (no picker sheets); the phone sheet opens pickers.
  const inline = variant === 'panel'
  const b: Draft = isNew ? draft : (booking as Booking)
  const kind = b.kind
  const rows = KIND_ROWS[kind ?? 'ticket']

  const entered = (m: Draft) =>
    !!(
      m.title?.trim() !== initialTitle.trim() ||
      m.place ||
      m.end_place ||
      m.confirmation_code ||
      m.notes ||
      m.ends_at ||
      m.kind !== inferKind(initialTitle) ||
      m.starts_at !== (defaultStart ?? null)
    )

  const apply = (p: Record<string, unknown>) => {
    const next = { ...p }
    // The zone follows the place (or the trip's), unless the person set it by hand.
    if ('place' in p) {
      const derived = b.place?.tz || tripTz
      const manual = !!b.start_tz && b.start_tz !== derived
      if (!manual) {
        const tz = (p.place as Place | null)?.tz || tripTz
        next.start_tz = tz && tz !== tripTz ? tz : null
      }
    }
    if (isNew) {
      const merged = { ...draft, ...(next as Draft) }
      setDraft(merged)
      onDirty?.(entered(merged))
    } else onSave((booking as Booking).booking_id, next)
  }

  const create = () => {
    if (!kind || !draft.title?.trim()) return
    onSave(null, {
      kind,
      title: draft.title.trim(),
      ...(draft.confirmation_code ? { confirmation_code: draft.confirmation_code } : {}),
      starts_at: draft.starts_at ?? null,
      ends_at: draft.ends_at ?? null,
      // Always a defined zone: the place's, else the trip's. The end follows its own place (the
      // server derives it) and otherwise the trip's.
      start_tz: draft.start_tz ?? tripTz ?? null,
      ...(draft.end_tz
        ? { end_tz: draft.end_tz }
        : !draft.end_place && tripTz
          ? { end_tz: tripTz }
          : {}),
      place: draft.place ?? null,
      ...(draft.end_place ? { end_place: draft.end_place } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
    })
  }

  const dirty = isNew && entered(draft)

  // ---- the kind comes first when adding ------------------------------------------------
  if (isNew && !kind) {
    return (
      <Sheet
        variant={variant}
        open={open}
        onClose={onClose}
        label="New booking"
        identity={<SheetIdentity title="New booking" context="What kind is it?" />}
        dirty={dirty}
        discardTitle="Discard this booking?"
      >
        <div className="trip-kindstep">
          <KindPick onPick={(k) => apply({ kind: k })} />
        </div>
      </Sheet>
    )
  }
  const k = kind as BookingKind

  // ---- when ----------------------------------------------------------------------------
  const start = splitDt(b.starts_at)
  const end = splitDt(b.ends_at)
  const firstDay = (days.find((d) => d.value)?.value as string | undefined) ?? undefined
  const sameZone = (b.end_tz || b.start_tz || '') === (b.start_tz || '')
  const setStartDay = (d: string | null) => {
    if (!d) return
    const next: Record<string, unknown> = { starts_at: joinDt(d, start.t || '09:00') }
    // A stay or a car keeps its length when it moves.
    if (b.ends_at && end.d && start.d) {
      const gap = Math.round(
        (Date.parse(`${end.d}T00:00:00Z`) - Date.parse(`${start.d}T00:00:00Z`)) / 86400000,
      )
      next.ends_at = joinDt(addDays(d, Math.max(0, gap)), end.t || '12:00')
    }
    apply(next)
  }
  const setStartTime = (t: string | null) => {
    const day = start.d || firstDay
    if (t && day) apply({ starts_at: joinDt(day, t) })
  }
  const setEndDay = (d: string | null) => {
    if (d) apply({ ends_at: joinDt(d, end.t || '12:00') })
  }
  const setEndTime = (t: string | null) => {
    if (!t) return apply({ ends_at: null })
    const day = end.d || start.d || firstDay
    if (!day) return
    // Arriving earlier on the clock than leaving, in one zone, means the next day.
    const wrap = rows.arrives && !end.d && start.t && t < start.t && sameZone
    apply({ ends_at: joinDt(wrap ? addDays(day, 1) : day, t) })
  }
  const zoneSuffix = (tz?: string | null) => (tz && tz !== tripTz ? ` ${zoneLabel(tz)}` : '')
  const whenText = (d: string, t: string, tz?: string | null) =>
    d ? `${shortDay(d)}${t ? `, ${t}` : ''}${zoneSuffix(tz)}` : ''

  // ---- the state line ---------------------------------------------------------------------
  const full = b as Booking
  const s0 = bookingStartMs(full, tripTz)
  const e0 = bookingEndMs(full, tripTz) ?? s0
  const state = isNew
    ? 'New booking'
    : e0 !== null && e0 < nowMs
      ? 'Used'
      : s0 !== null && s0 <= nowMs
        ? `Now${end.d ? ` · until ${shortDay(end.d)}${end.t ? `, ${end.t}` : ''}` : ''}`
        : s0 !== null && start.d
          ? `Next · ${shortDay(start.d)}${start.t ? ` ${start.t}` : ''}`
          : bookingSub(full)
  // "Lisbon → Porto" leads the line once both ends are known.
  const context = [bookingRoute(full), state].filter(Boolean).join(' · ')
  const underway = s0 !== null && s0 <= nowMs

  // Open Maps goes to where it ends once it is under way (arriving), else to where it starts.
  const pin = underway && hasPin(b.end_place) ? b.end_place : hasPin(b.place) ? b.place : null
  const placeLine = (p?: Place | null) =>
    p ? [p.name, p.locality].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') : ''
  const placeText = placeLine(b.place)
  const endPlaceText = placeLine(b.end_place)
  const code = b.confirmation_code

  const kindTile = (
    <Sheet
      variant="chips"
      open={kindOpen}
      onOpen={() => setKindOpen(true)}
      onClose={() => setKindOpen(false)}
      label="Kind"
      title="Kind"
      anchor={
        <button
          type="button"
          className="trip-kind-tile"
          aria-label={`Kind, ${BOOKING_KINDS.find((x) => x.value === k)?.label}`}
          disabled={locked}
        >
          {KIND_ICON[k]}
        </button>
      }
    >
      <KindPick
        value={k}
        onPick={(v) => {
          setKindOpen(false)
          apply({ kind: v })
        }}
      />
    </Sheet>
  )

  const menu = !locked ? (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      menu={{
        items: [{ key: 'zones', label: 'Change time zone' }],
        onClick: () => setZonesOpen(true),
      }}
    >
      <Button
        kind="text"
        iconOnly
        aria-label="More booking options"
        icon={<DotsThree weight="bold" />}
      />
    </Dropdown>
  ) : undefined

  return (
    <>
      <Sheet
        variant={variant}
        open={open}
        onClose={onClose}
        label={isNew ? 'New booking' : b.title || 'Booking'}
        menu={menu}
        dirty={dirty}
        discardTitle="Discard this booking?"
        identity={
          <>
            {note && (
              <p className="trip-note-line" role="status">
                {note}{' '}
                <Button kind="text" onClick={onDismissNote}>
                  Got it
                </Button>
              </p>
            )}
            <SheetIdentity
              leading={kindTile}
              title={b.title ?? ''}
              onTitle={(v) => apply({ title: v })}
              autoFocus={isNew && !b.title}
              disabled={locked}
              placeholder="Name this booking"
              context={context}
            />
          </>
        }
        actions={
          <SheetActions>
            {isNew ? (
              <Button kind="key" disabled={!draft.title?.trim()} onClick={create}>
                Add booking
              </Button>
            ) : (
              pin && (
                <Button
                  kind="key"
                  href={mapsUrl(pin.lat, pin.lng, pin.place_id)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open Maps
                </Button>
              )
            )}
            {code && (
              <CodeReveal
                code={code}
                title={b.title ?? 'Booking'}
                kind={k}
                line={[start.t, b.place?.name].filter(Boolean).join(' · ')}
                onCopy={onCopy}
                onEdit={locked || inline ? undefined : () => setCodeOpen(true)}
              />
            )}
          </SheetActions>
        }
        details={
          <DetailGroup label="Details">
            {inline && (
              <InlineWhen
                label={rows.start}
                days={days}
                day={start.d || firstDay || null}
                time={start.t || null}
                dayLabel={`${rows.start} day`}
                timeLabel={`${rows.start} time`}
                suffix={zoneSuffix(b.start_tz).trim()}
                disabled={locked}
                autoFocusTime={focusTime}
                onDay={setStartDay}
                onTime={setStartTime}
              />
            )}
            {inline && rows.hasEnd && (
              <InlineWhen
                label={rows.end}
                days={days}
                day={end.d || start.d || firstDay || null}
                time={end.t || null}
                clearableTime
                dayLabel={`${rows.end} day`}
                timeLabel={`${rows.end} time`}
                suffix={zoneSuffix(b.end_tz || b.end_place?.tz || b.start_tz).trim()}
                disabled={locked}
                onDay={setEndDay}
                onTime={setEndTime}
              />
            )}
            {!inline && (
              <NavRow
                label={rows.start}
                value={whenText(start.d, start.t, b.start_tz) || 'Add a time'}
                empty={!start.d}
                disabled={locked}
                defaultOpen={focusTime}
                picker={{
                  title: rows.start,
                  content: () => (
                    <WhenPick
                      days={days}
                      day={start.d || null}
                      time={start.t || null}
                      timeLabel="Starts"
                      onDay={setStartDay}
                      onTime={setStartTime}
                    />
                  ),
                }}
              />
            )}
            {!inline && rows.hasEnd && (
              <NavRow
                label={rows.end}
                value={
                  whenText(end.d, end.t, b.end_tz || b.end_place?.tz || b.start_tz) || 'Add a time'
                }
                empty={!end.d}
                disabled={locked}
                picker={{
                  title: rows.end,
                  content: () => (
                    <WhenPick
                      days={days}
                      day={end.d || start.d || null}
                      time={end.t || null}
                      clearableTime
                      timeLabel="Ends"
                      onDay={setEndDay}
                      onTime={setEndTime}
                    />
                  ),
                }}
              />
            )}
            {inline && (
              <div className="ui-inline-row is-top">
                <span className="ui-navrow-label" aria-hidden>
                  {rows.place}
                </span>
                <InlinePlace
                  label="Booking place"
                  value={b.place}
                  bias={bias}
                  near={near}
                  onChange={(p) => apply({ place: p })}
                  onText={(t) => apply({ place: placeFromTyped(t, bias, tripTz) })}
                />
              </div>
            )}
            {inline && rows.endPlace && (
              <div className="ui-inline-row is-top">
                <span className="ui-navrow-label" aria-hidden>
                  {rows.endPlace}
                </span>
                <InlinePlace
                  label="Booking end place"
                  value={b.end_place}
                  bias={bias}
                  near={near}
                  onChange={(p) => apply({ end_place: p })}
                  onText={(t) => apply({ end_place: placeFromTyped(t, bias, tripTz) })}
                />
              </div>
            )}
            {!inline && (
              <NavRow
                label={rows.place}
                value={placeText || (rows.place === 'From' ? 'Add where from' : 'Add a place')}
                empty={!placeText}
                disabled={locked}
                picker={{
                  title: 'Place',
                  content: (close) => (
                    <PlacePicker
                      label="Booking place"
                      value={b.place}
                      bias={bias}
                      near={near}
                      tz={tripTz}
                      onChange={(p) => {
                        apply({ place: p })
                        if (p) close()
                      }}
                    />
                  ),
                }}
              />
            )}
            {!inline && rows.endPlace && (
              <NavRow
                label={rows.endPlace}
                value={endPlaceText || 'Add where to'}
                empty={!endPlaceText}
                disabled={locked}
                picker={{
                  title: 'To',
                  content: (close) => (
                    <PlacePicker
                      label="Booking end place"
                      value={b.end_place}
                      bias={bias}
                      near={near}
                      tz={tripTz}
                      onChange={(p) => {
                        apply({ end_place: p })
                        if (p) close()
                      }}
                    />
                  ),
                }}
              />
            )}
            {inline && (
              <div className="ui-inline-row">
                <span className="ui-navrow-label" aria-hidden>
                  Code
                </span>
                <Field
                  aria-label="Confirmation code"
                  className="ui-inline-input"
                  defaultValue={code ?? ''}
                  disabled={locked}
                  maxLength={64}
                  placeholder="Add confirmation code"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== (code ?? '')) apply({ confirmation_code: v })
                  }}
                />
              </div>
            )}
            {!inline && (
              <NavRow
                label="Code"
                value={code ? mask(code) : 'Add confirmation code'}
                empty={!code}
                disabled={locked}
                open={codeOpen}
                onOpenChange={setCodeOpen}
                picker={{
                  title: 'Confirmation code',
                  content: (close) => (
                    <Field
                      aria-label="Confirmation code"
                      defaultValue={code ?? ''}
                      maxLength={64}
                      placeholder="Confirmation code"
                      // biome-ignore lint/a11y/noAutofocus: the picker opens to type in it
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v !== (code ?? '')) apply({ confirmation_code: v })
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
                  value={b.notes ?? ''}
                  max={LIMITS.itemNotesBytes}
                  autoFocus={false}
                  onCommit={(v) => apply({ notes: v })}
                />
              </div>
            ) : (
              <NavRow
                label="Note"
                value={b.notes ? b.notes.split('\n')[0] : 'Add a note'}
                empty={!b.notes}
                disabled={locked}
                picker={{
                  title: 'Note',
                  content: () => (
                    <NotePick
                      value={b.notes ?? ''}
                      max={LIMITS.itemNotesBytes}
                      onCommit={(v) => apply({ notes: v })}
                    />
                  ),
                }}
              />
            )}
            {!isNew && linked && linked.length > 0 && (
              <NavRow
                label="Linked to"
                value={linked.map((l) => l.title).join(', ')}
                onClick={() => onOpenTodo?.(linked[0].id)}
              />
            )}
          </DetailGroup>
        }
        footer={
          isNew ? undefined : (
            <SheetFooter
              who={byline}
              onDelete={locked ? undefined : onDelete}
              deleteLabel="Delete booking"
            />
          )
        }
      />
      <ZoneSheet
        open={zonesOpen}
        startTz={b.start_tz}
        endTz={b.end_tz}
        tripTz={tripTz}
        onClose={() => setZonesOpen(false)}
        onSave={(patch) => apply(patch)}
      />
    </>
  )
}

/** A rarely needed override: the zones come from the places, so typing one is tucked away. */
const ZoneSheet: React.FC<{
  open: boolean
  startTz?: string | null
  endTz?: string | null
  tripTz?: string
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => void
}> = ({ open, startTz, endTz, tripTz, onClose, onSave }) => {
  const [error, setError] = useState('')
  const [zones, setZones] = useState<string[] | null>(null)
  const commit = (field: 'start_tz' | 'end_tz', v: string, cur?: string | null) => {
    const z = v.trim() ? normalizeZone(v) : null
    if (v.trim() && !z) return setError('Time zones look like Europe/Lisbon.')
    setError('')
    if (z !== (cur ?? null)) onSave({ [field]: z })
  }
  // The long list of zone names is only built once a field is used.
  const load = () =>
    setZones(
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [],
    )
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Time zone"
      identity={
        <SheetIdentity
          title="Time zone"
          context="Times follow the place. Change a zone here only if a time reads wrong."
        />
      }
      details={
        <DetailGroup label="Time zones">
          <div className="ui-fieldrow">
            <span className="ui-navrow-label">Starts in</span>
            <Field
              list="trip-zone-list"
              aria-label="Start time zone"
              placeholder={tripTz ?? 'Europe/Lisbon'}
              defaultValue={startTz ?? ''}
              onFocus={load}
              onBlur={(e) => commit('start_tz', e.target.value, startTz)}
            />
          </div>
          <div className="ui-fieldrow">
            <span className="ui-navrow-label">Ends in</span>
            <Field
              list="trip-zone-list"
              aria-label="End time zone"
              placeholder="Same as start"
              defaultValue={endTz ?? ''}
              onFocus={load}
              onBlur={(e) => commit('end_tz', e.target.value, endTz)}
            />
          </div>
          {zones && (
            <datalist id="trip-zone-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          )}
          {error && (
            <div role="alert" className="trip-error">
              {error}
            </div>
          )}
        </DetailGroup>
      }
    />
  )
}
