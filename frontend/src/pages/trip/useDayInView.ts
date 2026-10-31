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
  // On a desk the days scroll inside this container, not the window.
  getScroller?: () => HTMLElement | null
}

/** Where the reading line sits. Near the end the pane stops scrolling before the last days can
 *  reach it, so over that last stretch (`remaining` px left to scroll) the line slides down to the
 *  bottom edge, one pixel per pixel scrolled: every day gets its turn, the last one at the end. */
export function readingLine(line: number, height: number, remaining: number) {
  return Math.max(line, height - Math.max(0, remaining))
}

/** The card the line falls on: the last one whose top is at or above it (cards in page order). */
export function dayAtLine(cards: { date: string; top: number }[], y: number): string | null {
  let at: string | null = cards[0]?.date ?? null
  for (const c of cards) if (c.top <= y) at = c.date
  return at
}

/** The day being read: the first day card that crosses a reading line just below the sticky
 *  chrome. Starts at today (during the trip) or the first day, and puts a deep-linked day at the
 *  top once, on first paint. */
export function useDayInView({ days, segKey, phase, today, wantedDay, getScroller }: Args) {
  const [currentDay, setCurrentDay] = useState<string | null>(null)

  useEffect(() => {
    if (!segKey || typeof IntersectionObserver === 'undefined') return
    const inBand = new Set<string>()
    const scroller = getScroller?.() ?? null
    // In a pane: the line sits just under the sticky day header. In the window: a quarter down.
    const height = scroller ? scroller.clientHeight : window.innerHeight
    const top = scroller ? 40 : window.innerWidth < 768 ? 120 : 24
    const line = scroller ? top + 16 : Math.max(top + 8, Math.round(height * 0.25))
    const cards = () => [...document.querySelectorAll<HTMLElement>('.trip-day[data-day]')]
    // Pixels left to scroll, or null when nothing scrolls.
    const remaining = () => {
      const total = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight
      const seen = scroller ? scroller.scrollTop + scroller.clientHeight : window.scrollY + height
      return total > height ? total - seen : null
    }
    let atEnd = false
    const pick = () => {
      const left = remaining()
      const y = left === null ? line : readingLine(line, height, left)
      atEnd = y > line
      if (atEnd) {
        const origin = scroller ? scroller.getBoundingClientRect().top : 0
        const at = dayAtLine(
          cards().map((el) => ({
            date: el.dataset.day as string,
            top: el.getBoundingClientRect().top - origin,
          })),
          y,
        )
        if (at) setCurrentDay(at)
        return
      }
      const first = [...inBand].sort()[0]
      if (first) setCurrentDay(first)
    }
    // The observer covers the reading line; scrolling covers the last stretch, where the line
    // moves, and the way back out of it.
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const was = atEnd
        const left = remaining()
        if (was || (left !== null && readingLine(line, height, left) > line)) pick()
      })
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const d = (e.target as HTMLElement).dataset.day as string
          if (e.isIntersecting) inBand.add(d)
          else inBand.delete(d)
        }
        pick()
      },
      // A one-pixel reading line a little below the sticky chrome: only the day being read
      // crosses it.
      {
        root: scroller,
        rootMargin: `-${line}px 0px -${Math.max(0, height - line - 1)}px 0px`,
      },
    )
    // Cards only: a slim done line is not a place you are "reading".
    for (const el of cards()) io.observe(el)
    const target = scroller ?? window
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      target.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [segKey, getScroller])

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
