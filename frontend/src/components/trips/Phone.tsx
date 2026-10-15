import React, { useEffect, useRef, useState } from 'react'
import { CaretUp, Check } from '@phosphor-icons/react'
import { fullness, type DayModel } from '@lib/trips/schedule'
import { dayColourVar } from './tripUi'

const WD = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow', timeZone: 'UTC' })

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

type StripProps = {
  days: DayModel[]
  current: string | null
  today: string
  // Days with every item ticked: muted, with a tick in place of the fullness bar.
  done: ReadonlySet<string>
  onPick: (date: string) => void
}

/** Phone date strip: one tab per day, with a bar showing how full the day is. */
export const DateStrip: React.FC<StripProps> = ({ days, current, today, done, onPick }) => {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  // Keep the day in view visible inside the strip without moving the page.
  useEffect(() => {
    const i = days.findIndex((d) => d.date === current)
    refs.current[i]?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [current, days])
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null || n < 0 || n >= days.length) return
    e.preventDefault()
    refs.current[n]?.focus()
    onPick(days[n].date)
  }
  return (
    <div className="trip-strip" role="tablist" aria-label="Days">
      {days.map((d, i) => {
        const on = d.date === current
        return (
          <button
            key={d.date}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on || (!current && i === 0) ? 0 : -1}
            aria-label={`${d.date}${d.date === today ? ', today' : ''}${done.has(d.date) ? ', done' : `, ${d.entries.length} stops`}`}
            className={['trip-strip-day', on ? 'is-on' : '', done.has(d.date) ? 'is-done' : '']
              .filter(Boolean)
              .join(' ')}
            style={{ '--day-colour': dayColourVar(i) } as React.CSSProperties}
            onClick={() => onPick(d.date)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="trip-strip-wd" aria-hidden>
              {WD.format(new Date(`${d.date}T00:00:00Z`))}
            </span>
            <span className="trip-strip-n" aria-hidden>
              {Number(d.date.slice(8))}
            </span>
            {done.has(d.date) ? (
              <Check className="trip-strip-tick" aria-hidden />
            ) : (
              <span className="trip-strip-bar" aria-hidden>
                <span style={{ transform: `scaleX(${fullness(d)})` }} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
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
