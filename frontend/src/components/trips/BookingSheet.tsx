import React, { useState } from 'react'
import { Button, Dropdown } from 'antd'
import { DotsThree, MapPin } from '@phosphor-icons/react'
import type { Booking, BookingKind, Place } from '@api/tripTypes'
import { LIMITS } from '@lib/trips/limits'
import { addDays, mapsUrl, zoneLabel } from '@lib/trips/schedule'
import { inferKind, joinDt, splitDt } from '@lib/trips/bookings'
import { BackBar, NotesField, Row, SheetTitle } from './ItemDetail'
import { DayChip, TimeChip } from './Chips'
import { CodeReveal } from './CodeReveal'
import type { MoveTarget } from './MoveMenu'
import { PlacePicker } from './PlacePicker'
import { Sheet } from './Sheet'
import { BOOKING_KINDS, KIND_ICON } from './tripUi'

type Bias = { lat: number; lng: number } | null

type Props = {
  mode: 'new' | 'edit'
  booking?: Booking
  // New: what was typed in the add bar. It is the title; a kind is guessed from it.
  initialTitle?: string
  tripTz?: string
  bias: Bias
  days: MoveTarget[]
  // A new booking starts here (a datetime-local value).
  defaultStart?: string
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

const validZone = (z: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z })
    return true
  } catch {
    return false
  }
}

/** Departure/arrival wording and which rows a kind shows. */
const KIND_ROWS: Record<
  BookingKind,
  { place: string; from: string; to: string; span: boolean; arrives: boolean }
> = {
  flight: { place: 'From', from: 'Departs', to: 'Arrives', span: false, arrives: true },
  train: { place: 'From', from: 'Departs', to: 'Arrives', span: false, arrives: true },
  stay: { place: 'Where', from: 'Check-in', to: 'Check-out', span: true, arrives: false },
  car: { place: 'Pick-up', from: 'Pick-up', to: 'Drop-off', span: true, arrives: false },
  ticket: { place: 'Where', from: 'When', to: '', span: false, arrives: false },
  other: { place: 'Where', from: 'When', to: '', span: false, arrives: false },
}

/** One sheet for adding and editing a booking. A new one starts with a kind and Create; an
 *  existing one saves as it changes. Same anatomy as a todo: a large title, rows, chips. */
export const BookingSheet: React.FC<Props> = ({
  mode,
  booking,
  initialTitle = '',
  tripTz,
  bias,
  days,
  defaultStart,
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
  const [view, setView] = useState<'main' | 'place'>('main')
  const [zonesOpen, setZonesOpen] = useState(false)
  const [codeEditing, setCodeEditing] = useState(false)
  const isNew = mode === 'new'
  const b: Draft = isNew ? draft : (booking as Booking)
  const kind = b.kind
  const rows = KIND_ROWS[kind ?? 'ticket']

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
      onDirty?.(
        !!(
          merged.title?.trim() !== initialTitle.trim() ||
          merged.place ||
          merged.confirmation_code ||
          merged.notes ||
          merged.ends_at ||
          merged.kind !== inferKind(initialTitle) ||
          merged.starts_at !== (defaultStart ?? null)
        ),
      )
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
      start_tz: draft.start_tz ?? null,
      end_tz: draft.end_tz ?? null,
      place: draft.place ?? null,
      ...(draft.notes ? { notes: draft.notes } : {}),
    })
  }

  // ---- when --------------------------------------------------------------------------
  const start = splitDt(b.starts_at)
  const end = splitDt(b.ends_at)
  const firstDay = (days.find((d) => d.value)?.value as string | undefined) ?? undefined
  const sameZone = (b.end_tz || b.start_tz || '') === (b.start_tz || '')
  const setStartDay = (d: string | null) => {
    if (!d) return
    const next: Record<string, unknown> = { starts_at: joinDt(d, start.t || '09:00') }
    // A stay or a car keeps its length when it moves; others keep their arrival day.
    if (b.ends_at && end.d) {
      const shift = rows.span || end.d !== start.d
      if (shift && start.d) {
        const gap = Math.round(
          (Date.parse(`${end.d}T00:00:00Z`) - Date.parse(`${start.d}T00:00:00Z`)) / 86400000,
        )
        next.ends_at = joinDt(addDays(d, Math.max(0, gap)), end.t || '12:00')
      }
    }
    apply(next)
  }
  const setStartTime = (t: string | null) => {
    if (!t) return
    const day = start.d || firstDay
    if (day) apply({ starts_at: joinDt(day, t) })
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
  const showArrivalDay = !!end.d && end.d !== start.d

  const zoneSuffix = (tz?: string | null) => (tz && tz !== tripTz ? zoneLabel(tz) : undefined)

  // ---- sub-views ----------------------------------------------------------------------
  if (view === 'place') {
    return (
      <div className="trip-sheet trip-booking">
        <BackBar onBack={() => setView('main')} title="Place" />
        <PlacePicker
          label="Booking place"
          value={b.place}
          bias={bias}
          tz={tripTz}
          onChange={(p) => {
            apply({ place: p })
            if (p) setView('main')
          }}
        />
      </div>
    )
  }

  const pin = b.place && b.place.source !== 'manual' ? b.place : null
  const placeText = b.place
    ? [b.place.name, b.place.locality].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')
    : ''
  const code = b.confirmation_code

  const whenRow = (
    label: string,
    d: string,
    t: string,
    tz: string | null | undefined,
    which: 's' | 'e',
  ) => (
    <div className="trip-when" role="group" aria-label={label}>
      <span className="trip-when-label">{label}</span>
      <DayChip
        value={d || null}
        days={days}
        placeholder="Add a day"
        disabled={locked}
        onPick={which === 's' ? setStartDay : setEndDay}
      />
      <TimeChip
        label={which === 's' ? 'Starts' : 'Ends'}
        value={t || null}
        clearable={which === 'e'}
        suffix={zoneSuffix(tz)}
        disabled={locked}
        autoFocus={which === 's' && focusTime}
        onPick={which === 's' ? setStartTime : setEndTime}
      />
    </div>
  )

  return (
    <div className="trip-sheet trip-booking">
      {note && (
        <div className="trip-note trip-note-sheet" role="status">
          <span>{note}</span>
          <Button size="small" type="link" onClick={onDismissNote}>
            Got it
          </Button>
        </div>
      )}

      <div className="trip-booking-top">
        {isNew ? (
          <div className="trip-kinds" role="group" aria-label="Kind of booking">
            {BOOKING_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className="trip-kind"
                aria-pressed={kind === k.value}
                onClick={() => apply({ kind: k.value })}
              >
                <span className="trip-kind-icon">{KIND_ICON[k.value]}</span>
                <span className="trip-kind-label">{k.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <KindChip
            kind={kind as BookingKind}
            disabled={locked}
            onPick={(k) => apply({ kind: k })}
          />
        )}
        {kind && !locked && (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [{ key: 'zones', label: 'Change time zone' }],
              onClick: () => setZonesOpen(true),
            }}
          >
            <Button
              type="text"
              shape="circle"
              aria-label="More booking options"
              icon={<DotsThree weight="bold" />}
            />
          </Dropdown>
        )}
      </div>

      {kind && (
        <>
          <SheetTitle
            value={b.title ?? ''}
            onCommit={(v) => apply({ title: v })}
            autoFocus={isNew && !b.title}
            placeholder="Name this booking"
            disabled={locked}
            leading={<span className="trip-stub-icon is-big">{KIND_ICON[kind]}</span>}
          />

          <Row
            icon={<MapPin aria-hidden />}
            onClick={() => setView('place')}
            disabled={locked}
            label={rows.place}
          >
            {placeText || (
              <span className="trip-muted">
                {rows.place === 'From' ? 'Add where from' : 'Add a place'}
              </span>
            )}
          </Row>

          {whenRow(rows.from, start.d, start.t, b.start_tz, 's')}
          {(rows.to || rows.arrives) &&
            (rows.arrives ? (
              <div className="trip-when" role="group" aria-label={rows.to}>
                <span className="trip-when-label">{rows.to}</span>
                {showArrivalDay && (
                  <DayChip value={end.d} days={days} disabled={locked} onPick={setEndDay} />
                )}
                <TimeChip
                  label="Ends"
                  value={end.t || null}
                  clearable
                  suffix={zoneSuffix(b.end_tz)}
                  disabled={locked}
                  onPick={setEndTime}
                />
              </div>
            ) : (
              whenRow(rows.to, end.d, end.t, b.end_tz || b.start_tz, 'e')
            ))}

          {code && !codeEditing ? (
            <div className="trip-code-row">
              <span className="trip-code-label">Code</span>
              <CodeReveal
                compact
                code={code}
                title={b.title ?? 'Booking'}
                kind={kind}
                line={[start.t, b.place?.name].filter(Boolean).join(' · ')}
                onCopy={onCopy}
                onEdit={locked ? undefined : () => setCodeEditing(true)}
              />
            </div>
          ) : codeEditing || (!code && !locked) ? (
            <CodeField
              initial={code ?? ''}
              open={codeEditing}
              onCommit={(v) => {
                setCodeEditing(false)
                if (v !== (code ?? '')) apply({ confirmation_code: v })
              }}
            />
          ) : null}

          <NotesField
            value={b.notes ?? ''}
            max={LIMITS.itemNotesBytes}
            disabled={locked}
            onCommit={(v) => apply({ notes: v })}
          />

          {!isNew && linked && linked.length > 0 && (
            <button
              type="button"
              className="trip-linked"
              onClick={() => onOpenTodo?.(linked[0].id)}
            >
              Linked to {linked.map((l) => l.title).join(', ')} ›
            </button>
          )}

          {isNew ? (
            <div className="trip-sheet-foot is-create">
              <Button
                type="primary"
                shape="round"
                size="large"
                block
                disabled={!kind || !draft.title?.trim()}
                onClick={create}
              >
                Add booking
              </Button>
            </div>
          ) : (
            <div className="trip-sheet-foot">
              {pin && (
                <a
                  className="ant-btn ant-btn-primary ant-btn-round ant-btn-lg trip-go"
                  href={mapsUrl(pin.lat, pin.lng)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open in Maps
                </a>
              )}
              {byline && <p className="trip-byline">{byline}</p>}
              {!locked && onDelete && (
                <button type="button" className="trip-delete" onClick={onDelete}>
                  Delete booking
                </button>
              )}
            </div>
          )}
        </>
      )}

      <ZoneSheet
        open={zonesOpen}
        startTz={b.start_tz}
        endTz={b.end_tz}
        tripTz={tripTz}
        onClose={() => setZonesOpen(false)}
        onSave={(patch) => apply(patch)}
      />
    </div>
  )
}

/** The kind as a small chip ("STAY ▾") that opens the six kinds. */
const KindChip: React.FC<{
  kind: BookingKind
  disabled?: boolean
  onPick: (k: BookingKind) => void
}> = ({ kind, disabled, onPick }) => {
  const [open, setOpen] = useState(false)
  const label = BOOKING_KINDS.find((k) => k.value === kind)?.label ?? 'Other'
  return (
    <>
      <button
        type="button"
        className="trip-chip trip-kindchip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Kind, ${label}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="trip-kind-icon">{KIND_ICON[kind]}</span>
        {label.toUpperCase()}
      </button>
      <Sheet title="Kind" open={open} onClose={() => setOpen(false)}>
        <div className="trip-sheet-pad">
          <div className="trip-kinds" role="group" aria-label="Kind of booking">
            {BOOKING_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className="trip-kind"
                aria-pressed={kind === k.value}
                onClick={() => {
                  setOpen(false)
                  onPick(k.value)
                }}
              >
                <span className="trip-kind-icon">{KIND_ICON[k.value]}</span>
                <span className="trip-kind-label">{k.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Sheet>
    </>
  )
}

/** The code: "Add confirmation code" until you tap it, then an inline field. */
const CodeField: React.FC<{
  initial: string
  open: boolean
  onCommit: (v: string) => void
}> = ({ initial, open, onCommit }) => {
  const [editing, setEditing] = useState(open)
  if (!editing)
    return (
      <button type="button" className="trip-sheet-row" onClick={() => setEditing(true)}>
        <span className="trip-sheet-row-text">
          <span className="trip-muted">Add confirmation code</span>
        </span>
      </button>
    )
  return (
    <input
      className="trip-sheet-line"
      aria-label="Confirmation code"
      defaultValue={initial}
      maxLength={64}
      // biome-ignore lint/a11y/noAutofocus: the field opens because the row was tapped
      autoFocus
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      onBlur={(e) => {
        setEditing(false)
        onCommit(e.target.value.trim())
      }}
    />
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
    const z = v.trim()
    if (z && !validZone(z)) return setError('Time zones look like Europe/Lisbon.')
    setError('')
    if ((z || null) !== (cur ?? null)) onSave({ [field]: z || null })
  }
  // The long list of zone names is only built once a field is used.
  const load = () =>
    setZones(
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [],
    )
  return (
    <Sheet title="Time zone" open={open} onClose={onClose}>
      <div className="trip-sheet-pad trip-zones">
        <p className="trip-help">
          Times follow the place. Change a zone here only if a time reads wrong.
        </p>
        <label className="trip-zone-field">
          <span>Starts in</span>
          <input
            className="trip-chip"
            list="trip-zone-list"
            aria-label="Start time zone"
            placeholder={tripTz ?? 'Europe/Lisbon'}
            defaultValue={startTz ?? ''}
            onFocus={load}
            onBlur={(e) => commit('start_tz', e.target.value, startTz)}
          />
        </label>
        <label className="trip-zone-field">
          <span>Ends in</span>
          <input
            className="trip-chip"
            list="trip-zone-list"
            aria-label="End time zone"
            placeholder="Same as start"
            defaultValue={endTz ?? ''}
            onFocus={load}
            onBlur={(e) => commit('end_tz', e.target.value, endTz)}
          />
        </label>
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
      </div>
    </Sheet>
  )
}
