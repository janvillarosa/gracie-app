import { useEffect, useRef, useState } from 'react'
import type { DayModel } from '@lib/trips/schedule'
import { scrollToEl } from './scroll'

type Args = {
  days: DayModel[]
  // Changes whenever the set of day cards (or which are closed) changes, so the observer re-binds.
  segKey: string
  phase: string
  today: string
  // The `?day=` of a deep link, if any.
  wantedDay: string | null
}

/** The day being read: the first day card that crosses a reading line just below the sticky
 *  chrome. Starts at today (during the trip) or the first day, and puts a deep-linked day at the
 *  top once, on first paint. */
export function useDayInView({ days, segKey, phase, today, wantedDay }: Args) {
  const [currentDay, setCurrentDay] = useState<string | null>(null)

  useEffect(() => {
    if (!segKey || typeof IntersectionObserver === 'undefined') return
    const inBand = new Set<string>()
    const top = window.innerWidth < 768 ? 120 : 24
    const line = Math.max(top + 8, Math.round(window.innerHeight * 0.25))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const d = (e.target as HTMLElement).dataset.day as string
          if (e.isIntersecting) inBand.add(d)
          else inBand.delete(d)
        }
        const first = [...inBand].sort()[0]
        if (first) setCurrentDay(first)
      },
      // A one-pixel reading line a little below the sticky chrome: only the day being read
      // crosses it.
      { rootMargin: `-${line}px 0px -${Math.max(0, window.innerHeight - line - 1)}px 0px` },
    )
    // Cards only: a slim done line is not a place you are "reading".
    for (const el of document.querySelectorAll('.trip-day[data-day]')) io.observe(el)
    return () => io.disconnect()
  }, [segKey])

  useEffect(() => {
    setCurrentDay((c) => c ?? (phase === 'during' ? today : (days[0]?.date ?? null)))
    // biome-ignore lint/correctness/useExhaustiveDependencies: only the first value matters
  }, [days])

  // First paint: the top of the page, unless the URL carried a day (a deep link).
  const placed = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the days first exist
  useEffect(() => {
    if (placed.current || !days.length) return
    placed.current = true
    if (!wantedDay || !days.some((d) => d.date === wantedDay)) return
    requestAnimationFrame(() => scrollToEl(document.getElementById(`day-${wantedDay}`), false))
  }, [days.length])

  return { currentDay, setCurrentDay }
}
