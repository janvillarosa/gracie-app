import React, { useEffect, useRef } from 'react'
import { Button, Chip } from '@components/ui'
import type { Place } from '@api/tripTypes'
import { DayPick } from './pickers'

type Props = {
  // Where the click landed, in the map pane's pixels, and the pane's size (to keep the card inside).
  at: { x: number; y: number }
  bounds: { w: number; h: number }
  // The place once resolved; null while it is being found.
  place: Place | null
  // Reverse geocoding gave nothing: "Dropped pin", with a name you can type.
  degraded: boolean
  name: string
  onName: (v: string) => void
  // "Add to Thu 15" and the days (or Ideas) it could go to instead.
  targetLabel: string
  targets: Array<{ value: string; label: string }>
  target: string
  onTarget: (v: string) => void
  onAdd: () => void
  onMore: () => void
  onDismiss: () => void
}

const WIDTH = 292

/** A paper card anchored to the pin a click dropped on the map. Nothing exists until the
 *  yellow key is pressed. A dialog: focus moves in and stays in, Esc or a click elsewhere closes. */
export const MapAddPopover: React.FC<Props> = ({
  at,
  bounds,
  place,
  degraded,
  name,
  onName,
  targetLabel,
  targets,
  target,
  onTarget,
  onAdd,
  onMore,
  onDismiss,
}) => {
  const root = useRef<HTMLDivElement>(null)
  const ready = !!place
  const title = ready ? (degraded ? 'Dropped pin' : (place.name ?? '')) : 'Finding the place…'

  // Focus moves in; Esc and a press outside close it; Tab stays inside.
  useEffect(() => {
    root.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
      }
      if (e.key === 'Tab' && root.current) {
        const items = [
          ...root.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input, [tabindex="0"]',
          ),
        ]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        const on = document.activeElement
        if (e.shiftKey && (on === first || on === root.current)) {
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
  const below = at.y < 150
  return (
    // biome-ignore lint/a11y/useSemanticElements: a popover dialog anchored to a map pin
    <div
      ref={root}
      className={below ? 'map-add is-below' : 'map-add'}
      role="dialog"
      aria-label={
        ready
          ? `Add ${degraded ? 'a dropped pin' : place.name} to ${targetLabel}`
          : 'Finding the place'
      }
      tabIndex={-1}
      style={{ left, top: at.y, width: WIDTH }}
    >
      {ready && degraded ? (
        <input
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
      {ready && !degraded && place.locality && place.locality !== place.name && (
        <p className="map-add-line">{place.locality}</p>
      )}
      <div className="map-add-actions">
        <Button kind="key" disabled={!ready} onClick={onAdd}>
          Add to {targetLabel}
        </Button>
        <Chip label="Add to" value={targetLabel} title="Add to" className="map-add-day">
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
      </div>
      {ready && (
        <button type="button" className="map-add-more" onClick={onMore}>
          More details
        </button>
      )}
    </div>
  )
}
