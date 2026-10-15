import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui'
import { CaretDown, X } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { hasPin, placeText } from '@lib/trips/places'
import { DayPick } from './pickers'
import { MapsLink } from './MapsLink'

type Props = {
  // Where the click landed, in the map pane's pixels, and the pane's size (to keep the card inside).
  at: { x: number; y: number }
  bounds: { w: number; h: number }
  // The place once resolved; null while it is being found.
  place: Place | null
  // A dropped pin (no Google place): the name is a field, prefilled with the geocoded address.
  degraded: boolean
  name: string
  onName: (v: string) => void
  // The Google place type in plain words ("Palace"), display only.
  typeName?: string
  // The day the key adds to ("Thu 15", or "Ideas") and the days (or Ideas) the caret offers.
  targetLabel: string
  targets: Array<{ value: string; label: string }>
  target: string
  // The left of the split key: add to `target`.
  onAdd: () => void
  // The caret's list: adding happens on pick.
  onAddTo: (target: string) => void
  // The place is already in the trip: "On Thu 15" and a quiet "Show".
  existing?: { label: string; onShow: () => void } | null
  onDismiss: () => void
}

const WIDTH = 300
// Below this pane width the key's label shrinks to "Add".
const COMPACT = 340

/** A paper card anchored to the pin a click dropped on the map (the chips-sheet look: radius 16,
 *  20px padding, a close key). Identity, then one row of actions: a split key (add to the day, or
 *  pick another day or Ideas from the caret) and a quiet "Open in Google Maps". Nothing exists
 *  until the key is pressed. A dialog: Esc, a click elsewhere or the close key dismisses it. */
export const MapAddPopover: React.FC<Props> = ({
  at,
  bounds,
  place,
  degraded,
  name,
  onName,
  typeName,
  targetLabel,
  targets,
  target,
  onAdd,
  onAddTo,
  existing,
  onDismiss,
}) => {
  const root = useRef<HTMLDivElement>(null)
  const keyRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  const ready = !!place
  const shown = placeText(place)
  const title = ready ? shown.name || 'Saved place' : 'Finding the place…'
  const line = [typeName, place?.locality && place.locality !== shown.name ? place.locality : '']
    .filter(Boolean)
    .join(' · ')
  const compact = bounds.w < COMPACT

  // Focus moves to the key (or the name of a dropped pin), with that control's own ring.
  useEffect(() => {
    if (!ready) return
    if (degraded) nameRef.current?.focus({ preventScroll: true })
    else keyRef.current?.focus({ preventScroll: true })
  }, [ready, degraded])

  // Esc and a press outside close it; Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
      if (e.key === 'Tab' && root.current) {
        const items = [
          ...root.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input, a[href], [tabindex="0"]',
          ),
        ]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        const on = document.activeElement
        if (e.shiftKey && on === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && on === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        // Another click on the map replaces this card (the page handles it); elsewhere closes.
        if (!(e.target as Element).closest?.('.ant-popover')) onDismiss()
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onDismiss])

  const left = Math.min(
    Math.max(at.x, WIDTH / 2 + 8),
    Math.max(WIDTH / 2 + 8, bounds.w - WIDTH / 2 - 8),
  )
  // Above the pin unless there is no room.
  const below = at.y < 220
  const day = targets.filter((t) => t.value !== 'ideas')
  const placed = hasPin(place) ? place : null
  return (
    // biome-ignore lint/a11y/useSemanticElements: a popover dialog anchored to a map pin
    <div
      ref={root}
      className={below ? 'map-add is-below' : 'map-add'}
      role="dialog"
      aria-label={ready ? `Add ${degraded ? 'a dropped pin' : title} to ${targetLabel}` : 'Finding the place'}
      style={{ left, top: at.y, width: WIDTH }}
    >
      <Button
        kind="text"
        iconOnly
        className="map-add-close"
        aria-label="Close"
        icon={<X />}
        onClick={onDismiss}
      />
      {ready && degraded ? (
        <input
          ref={nameRef}
          className="map-add-name"
          aria-label="Place name"
          value={name}
          maxLength={120}
          placeholder="Dropped pin"
          onChange={(e) => onName(e.target.value)}
        />
      ) : (
        <h3 className="map-add-title">{title}</h3>
      )}
      {line && <p className="map-add-line">{line}</p>}
      {picking ? (
        <div className="map-add-days">
          <DayPick
            days={day.map((t) => ({ value: t.value as string | null, label: t.label }))}
            value={target === 'ideas' ? null : target}
            allowIdeas={targets.some((t) => t.value === 'ideas')}
            onPick={(d) => {
              setPicking(false)
              onAddTo(d === null ? 'ideas' : d)
            }}
          />
        </div>
      ) : (
        <div className="map-add-actions">
          {existing ? (
            <>
              <span className="map-add-on">{existing.label}</span>
              <Button kind="quiet" onClick={existing.onShow}>
                Show
              </Button>
            </>
          ) : (
            <span className="map-add-split">
              <Button
                ref={keyRef}
                kind="key"
                className="map-add-go"
                disabled={!ready}
                onClick={onAdd}
                aria-label={`Add to ${targetLabel}`}
              >
                {compact ? 'Add' : `Add to ${targetLabel}`}
              </Button>
              <Button
                kind="key"
                className="map-add-caret"
                disabled={!ready}
                aria-label="Choose another day"
                aria-expanded={picking}
                icon={<CaretDown weight="bold" aria-hidden />}
                onClick={() => setPicking(true)}
              />
            </span>
          )}
          {placed && (
            <MapsLink
              lat={placed.lat}
              lng={placed.lng}
              placeId={placed.place_id}
              provider="google"
              label="Open in Google Maps"
              iconOnly
              kind="quiet"
              className="map-add-open"
            />
          )}
        </div>
      )}
    </div>
  )
}
