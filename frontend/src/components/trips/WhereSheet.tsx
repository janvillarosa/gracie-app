import React from 'react'
import { Button } from '@components/ui'
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, DotsSixVertical, X } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { useSwipeToDelete } from '@components/ItemRow'
import { hasPin, placeText } from '@lib/trips/places'
import { PlacePicker } from './PlacePicker'

type Props = {
  stops: Place[]
  tz?: string
  // Every change is saved: the first place is the destination.
  onChange: (stops: Place[]) => void
}

const MAX_STOPS = 12

type RowProps = {
  id: string
  place: Place
  first: boolean
  last: boolean
  onMove: (d: -1 | 1) => void
  onRemove: () => void
}

const StopRow: React.FC<RowProps> = ({ id, place: raw, first, last, onMove, onRemove }) => {
  const place = { name: placeText(raw).name || 'Saved place' }
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id })
  const swipe = useSwipeToDelete(onRemove, false)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="trip-stop"
    >
      <div className="item-swipe">
        <div ref={swipe.trayRef} className="swipe-tray" aria-hidden>
          <X weight="bold" className="swipe-tray-icon" />
        </div>
        <div ref={swipe.slideRef} className="item-slide" {...swipe.handlers}>
          <div className="trip-stop-line">
            <span
              ref={setActivatorNodeRef}
              className="trip-stop-grip"
              aria-label={`Drag ${place.name}`}
              {...attributes}
              {...listeners}
            >
              <DotsSixVertical aria-hidden />
            </span>
            <span className="trip-stop-name">{place.name}</span>
            <span className="trip-stop-keys">
              <Button
                kind="text"
                iconOnly
                icon={<ArrowUp />}
                disabled={first}
                aria-label={`Move ${place.name} earlier`}
                onClick={() => onMove(-1)}
              />
              <Button
                kind="text"
                iconOnly
                icon={<ArrowDown />}
                disabled={last}
                aria-label={`Move ${place.name} later`}
                onClick={() => onMove(1)}
              />
              <Button
                kind="text"
                iconOnly
                icon={<X />}
                aria-label={`Remove ${place.name} from the route`}
                onClick={onRemove}
              />
            </span>
          </div>
        </div>
      </div>
    </li>
  )
}

/** "Where": the trip's places in order. The first is the destination. One idea, one list. */
export const WhereSheet: React.FC<Props> = ({ stops, tz, onChange }) => {
  const [adds, setAdds] = React.useState(0)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  const ids = stops.map((_, i) => `stop-${i}`)
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j >= 0 && j < stops.length) onChange(arrayMove(stops, i, j))
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    onChange(arrayMove(stops, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }
  return (
    <div className="trip-where">
      {stops.length === 0 && (
        <p className="trip-help">Add where you’re going. The first place is the destination.</p>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="trip-stops">
            {stops.map((p, i) => (
              <StopRow
                key={ids[i]}
                id={ids[i]}
                place={p}
                first={i === 0}
                last={i === stops.length - 1}
                onMove={(d) => move(i, d)}
                onRemove={() => onChange(stops.filter((_, k) => k !== i))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {stops.length < MAX_STOPS ? (
        <PlacePicker
          key={adds}
          label="Add a place"
          placeholder="Add a place"
          value={null}
          tz={tz}
          bias={hasPin(stops[0]) ? { lat: stops[0].lat, lng: stops[0].lng } : null}
          onChange={(p) => {
            if (!p) return
            onChange([...stops, p])
            setAdds((n) => n + 1)
          }}
        />
      ) : (
        <p className="trip-help">A route holds up to {MAX_STOPS} places.</p>
      )}
    </div>
  )
}
