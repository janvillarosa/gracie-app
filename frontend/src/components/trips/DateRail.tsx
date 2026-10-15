import React, { useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { RAIL_MS } from '@lib/trips/dragDrop'
import { shortDay } from '@lib/trips/schedule'

const RailChip: React.FC<{ date: string; onJump: (date: string) => void }> = ({ date, onJump }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `rail:${date}` })
  // Held over a chip for a beat, the Days column scrolls to that day.
  useEffect(() => {
    if (!isOver) return
    const t = setTimeout(() => onJump(date), RAIL_MS)
    return () => clearTimeout(t)
  }, [isOver, date, onJump])
  return (
    <span
      ref={setNodeRef}
      className={isOver ? 'ui-chip trip-rail-chip is-over' : 'ui-chip trip-rail-chip'}
    >
      {shortDay(date)}
    </span>
  )
}

/** A long trip while something is being dragged: a slim rail of dates at the top of the Days
 *  column. Drop on a date to put the item at the end of that day (or at its time) without
 *  scrolling; hold over one to scroll there. Not in the tab order: it is a drop target only (the
 *  keyboard has "Move to…"). */
export const DateRail: React.FC<{ days: string[]; onJump: (date: string) => void }> = ({
  days,
  onJump,
}) => (
  <div className="trip-date-rail" aria-hidden>
    <div className="trip-date-rail-inner">
      {days.map((d) => (
        <RailChip key={d} date={d} onJump={onJump} />
      ))}
    </div>
  </div>
)
