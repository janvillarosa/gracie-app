import React, { useState } from 'react'
import { Button, Popover } from 'antd'
import { ArrowDown, ArrowUp, X } from '@phosphor-icons/react'
import type { Place, Trip } from '@api/tripTypes'
import { countdown, dateRange, routeText, type Gap } from '@lib/trips/schedule'
import { AvatarBadge } from '@components/AvatarBadge'
import type { Member } from '@lib/trips/hooks'
import { PlacePicker } from './PlacePicker'

type DetailsProps = {
  trip: Trip
  onPatch: (patch: Record<string, unknown>) => void
  onDelete: () => void
  onClose: () => void
}

const MAX_STOPS = 12

// Trip details, in place: title, where, when, and the hand-entered route.
export const TripDetails: React.FC<DetailsProps> = ({ trip, onPatch, onDelete, onClose }) => {
  const [confirming, setConfirming] = useState(false)
  const stops = trip.stops ?? []
  const bias = trip.destination ? { lat: trip.destination.lat, lng: trip.destination.lng } : null

  const setStops = (next: Place[]) => onPatch({ stops: next })
  const move = (i: number, d: -1 | 1) => {
    const next = [...stops]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setStops(next)
  }
  const setDate = (field: 'start_date' | 'end_date', v: string) => {
    const patch: Record<string, unknown> = { [field]: v || null }
    // A trip is either dated or a draft; keep the pair consistent and the range ordered.
    if (field === 'start_date' && v && (!trip.end_date || trip.end_date < v)) patch.end_date = v
    if (field === 'end_date' && v && !trip.start_date) patch.start_date = v
    if (field === 'start_date' && !v) patch.end_date = null
    if (field === 'end_date' && !v) patch.start_date = null
    onPatch(patch)
  }

  return (
    <section className="trip-details" aria-label="Trip details">
      <label className="trip-label">
        Title
        <input
          className="trip-field"
          defaultValue={trip.title}
          maxLength={120}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (!v) e.target.value = trip.title
            else if (v !== trip.title) onPatch({ title: v })
          }}
        />
      </label>
      <div className="trip-label">
        Destination
        <PlacePicker
          label="Destination"
          value={trip.destination}
          bias={bias}
          tz={trip.tz}
          onChange={(p) => onPatch({ destination: p, ...(p?.tz ? { tz: p.tz } : {}) })}
        />
      </div>
      <div className="trip-editor-pair">
        <label className="trip-label">
          Starts
          <input
            className="trip-field"
            type="date"
            value={trip.start_date ?? ''}
            onChange={(e) => setDate('start_date', e.target.value)}
          />
        </label>
        <label className="trip-label">
          Ends
          <input
            className="trip-field"
            type="date"
            value={trip.end_date ?? ''}
            min={trip.start_date ?? undefined}
            onChange={(e) => setDate('end_date', e.target.value)}
          />
        </label>
      </div>
      <div className="trip-label">
        Route
        <ol className="trip-stops">
          {stops.map((s, i) => (
            <li key={`${s.name}-${s.lat}-${s.lng}`} className="trip-stop">
              <span className="trip-stop-name">{s.name}</span>
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<ArrowUp />}
                disabled={i === 0}
                aria-label={`Move ${s.name} earlier`}
                onClick={() => move(i, -1)}
              />
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<ArrowDown />}
                disabled={i === stops.length - 1}
                aria-label={`Move ${s.name} later`}
                onClick={() => move(i, 1)}
              />
              <Button
                type="text"
                shape="circle"
                size="small"
                icon={<X />}
                aria-label={`Remove ${s.name} from the route`}
                onClick={() => setStops(stops.filter((_, k) => k !== i))}
              />
            </li>
          ))}
        </ol>
        {stops.length < MAX_STOPS ? (
          <PlaceStopAdder bias={bias} tz={trip.tz} onAdd={(p) => setStops([...stops, p])} />
        ) : (
          <p className="trip-help">A route holds up to {MAX_STOPS} stops.</p>
        )}
      </div>
      <div className="trip-editor-foot">
        {confirming ? (
          <span className="trip-editor-btns" role="alert">
            Delete this trip for the whole House?
            <Button size="small" danger onClick={onDelete}>
              Yes, delete
            </Button>
            <Button size="small" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button size="small" danger onClick={() => setConfirming(true)}>
            Delete trip
          </Button>
        )}
        <Button size="small" onClick={onClose}>
          Done
        </Button>
      </div>
    </section>
  )
}

// A picker that clears itself after each choice, so stops can be added one after another.
const PlaceStopAdder: React.FC<{
  bias: { lat: number; lng: number } | null
  tz?: string
  onAdd: (p: Place) => void
}> = ({ bias, tz, onAdd }) => {
  const [n, setN] = useState(0)
  return (
    <PlacePicker
      key={n}
      label="Add a stop"
      placeholder="Add a stop"
      value={null}
      bias={bias}
      tz={tz}
      onChange={(p) => {
        if (p) {
          onAdd(p)
          setN((x) => x + 1)
        }
      }}
    />
  )
}

type HeaderProps = {
  trip: Trip
  today: string
  gaps: Gap[]
  offline: boolean
  pending: number
  deletedBy: string
  readOnlyOver: boolean
  members: Member[]
  onUnlock: () => void
  onRestore: () => void
  onGap: (target: string) => void
  onAddDates: () => void
}

/** Compact trip header: title, dates, who is in it, sync state and one pill for the gaps. */
export const TripHeader: React.FC<HeaderProps> = ({
  trip,
  today,
  gaps,
  offline,
  pending,
  deletedBy,
  readOnlyOver,
  members,
  onUnlock,
  onRestore,
  onGap,
  onAddDates,
}) => {
  const [gapsOpen, setGapsOpen] = useState(false)
  const route = routeText(trip)
  const when = dateRange(trip.start_date, trip.end_date)
  const count = countdown(trip, today)
  return (
    <header className="trip-header">
      {deletedBy && (
        <div className="trip-banner" role="status">
          <span>{deletedBy} deleted this trip.</span>
          <Button size="small" type="primary" onClick={onRestore}>
            Restore
          </Button>
        </div>
      )}
      <div className="trip-header-top">
        <h1>{trip.title}</h1>
        <span className="trip-avatars">
          {members.map((m) => (
            <AvatarBadge
              key={m.user_id ?? m.name}
              seed={m.avatar_key ?? m.name}
              name={m.name}
              size={26}
            />
          ))}
        </span>
      </div>
      <p className="trip-meta">
        {[route, when || 'No dates yet', count].filter(Boolean).join(' · ')}
        {!when && (
          <>
            {' '}
            <button type="button" className="trip-inline-link" onClick={onAddDates}>
              Add dates
            </button>
          </>
        )}
      </p>
      <div className="trip-header-row">
        {gaps.length > 0 && (
          <Popover
            trigger="click"
            placement="bottomLeft"
            open={gapsOpen}
            onOpenChange={setGapsOpen}
            overlayClassName="trip-gaps-pop"
            content={
              <ul className="trip-gaps" aria-label="Things to sort">
                {gaps.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="trip-gap"
                      onClick={() => {
                        setGapsOpen(false)
                        onGap(g.target)
                      }}
                    >
                      {g.text}
                    </button>
                  </li>
                ))}
              </ul>
            }
          >
            <button
              type="button"
              className="trip-gap-pill"
              aria-haspopup="true"
              aria-expanded={gapsOpen}
            >
              {gaps.length} to sort
            </button>
          </Popover>
        )}
        {(offline || pending > 0) && (
          <span className="trip-offline" role="status">
            {offline ? 'Saved on this device · syncs when online' : 'Syncing…'}
          </span>
        )}
        {trip.todos.length >= 140 && (
          <span className="trip-cap">{trip.todos.length} of 150 todos, nearly full</span>
        )}
      </div>
      {readOnlyOver && (
        <p className="trip-meta">
          This trip is over.{' '}
          <button type="button" className="trip-inline-link" onClick={onUnlock}>
            Edit anyway
          </button>
        </p>
      )}
    </header>
  )
}
