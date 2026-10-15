import React, { useEffect, useRef, useState } from 'react'
import { CaretUp } from '@phosphor-icons/react'

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const fn = () => setOn(mq.matches)
    fn()
    mq.addEventListener?.('change', fn)
    return () => mq.removeEventListener?.('change', fn)
  }, [query])
  return on
}

type SheetProps = {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

/** Pull-up map sheet. Its children (the map) only mount after the first pull. */
export const MapSheet: React.FC<SheetProps> = ({ title, open, onToggle, children }) => {
  const [pulled, setPulled] = useState(false)
  useEffect(() => {
    if (open) setPulled(true)
  }, [open])
  return (
    <div className={open ? 'trip-sheet is-open' : 'trip-sheet'}>
      <button
        type="button"
        className="trip-sheet-handle"
        aria-expanded={open}
        aria-controls="trip-sheet-body"
        onClick={onToggle}
      >
        <CaretUp aria-hidden />
        <span>{open ? 'Hide the map' : title}</span>
      </button>
      <div id="trip-sheet-body" className="trip-sheet-body" hidden={!open}>
        {pulled ? children : null}
      </div>
    </div>
  )
}
