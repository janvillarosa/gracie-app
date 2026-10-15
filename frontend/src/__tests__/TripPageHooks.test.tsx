import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSchedule, localDateKey, tripPhase } from '@lib/trips/schedule'
import { dayDone } from '@components/trips/Spine'
import { useDayFolding } from '../pages/trip/useDayFolding'
import { useDayInView } from '../pages/trip/useDayInView'
import { useDeck } from '../pages/trip/useDeck'
import { lisbonTrip, rel } from './trips.helpers'

// lisbonTrip: two finished days, today, a day ahead, an empty day, ideas and bookings.
const trip = lisbonTrip()
const schedule = buildSchedule(trip)
const today = localDateKey(new Date())
const phase = tripPhase(trip, today)
const nowMs = Date.now()

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})
afterEach(() => vi.useRealTimers())

describe('useDeck', () => {
  const deck = (over: Partial<Parameters<typeof useDeck>[0]> = {}) =>
    renderHook(() =>
      useDeck({
        trip,
        schedule,
        phase,
        today,
        nowMs,
        showNextStop: true,
        dismissed: new Set(),
        ...over,
      }),
    ).result.current

  it('deals today, in the day order, only during the trip', () => {
    expect(phase).toBe('during')
    const { deckStops, deckTopId } = deck()
    expect(deckStops.length).toBeGreaterThan(0)
    expect(deckTopId).toBe(deckStops.find((s) => !s.done)?.id)
  })

  it('deals nothing with the deck switched off, and offers a plain "next up" instead', () => {
    const { deckStops, nextUp } = deck({ showNextStop: false })
    expect(deckStops).toEqual([])
    expect(nextUp?.title).toBeTruthy()
  })

  it('names tomorrow’s first stop', () => {
    const { tomorrow } = deck()
    expect(tomorrow?.date).toBe(rel(1))
  })
})

describe('useDayFolding', () => {
  const doneDays = (todoDone: boolean) => {
    const t = lisbonTrip()
    if (todoDone) for (const x of t.todos) if (x.day === rel(0)) x.done = true
    const s = buildSchedule(t)
    return { days: s.days, done: new Set(s.days.filter(dayDone).map((d) => d.date)) }
  }

  it('opens today and tomorrow on a phone and folds the rest, with a toggle', () => {
    const { days, done } = doneDays(false)
    const onToggle = vi.fn()
    const { result } = renderHook(() =>
      useDayFolding({
        days,
        doneDays: done,
        phone: true,
        phase: 'during',
        today,
        announce: () => {},
        onToggle,
      }),
    )
    const d = (date: string) => days.find((x) => x.date === date)!
    expect(result.current.isOpenDay(d(rel(0)))).toBe(true)
    expect(result.current.isOpenDay(d(rel(1)))).toBe(true)
    expect(result.current.isOpenDay(d(rel(2)))).toBe(false)
    act(() => result.current.toggleDay(rel(2)))
    expect(result.current.isOpenDay(d(rel(2)))).toBe(true)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('opens every day on a wide screen', () => {
    const { days, done } = doneDays(false)
    const { result } = renderHook(() =>
      useDayFolding({
        days,
        doneDays: done,
        phone: false,
        phase: 'during',
        today,
        announce: () => {},
        onToggle: () => {},
      }),
    )
    for (const d of days) expect(result.current.isOpenDay(d)).toBe(true)
  })

  it('celebrates a day that has just finished, then folds it and says so', () => {
    vi.useFakeTimers()
    const before = doneDays(false)
    const after = doneDays(true)
    const announce = vi.fn()
    const { result, rerender } = renderHook(
      ({ done }: { done: ReadonlySet<string> }) =>
        useDayFolding({
          days: before.days,
          doneDays: done,
          phone: true,
          phase: 'during',
          today,
          announce,
          onToggle: () => {},
        }),
      { initialProps: { done: before.done } },
    )
    expect(result.current.celebrating.size).toBe(0)
    rerender({ done: after.done })
    expect(result.current.celebrating.has(rel(0))).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1200)
    })
    expect(result.current.celebrating.size).toBe(0)
    expect(announce).toHaveBeenCalledWith(expect.stringMatching(/done, folded$/))
  })
})

describe('useDayInView', () => {
  it('starts on today during the trip, and on the first day otherwise', () => {
    const { result } = renderHook(() =>
      useDayInView({ days: schedule.days, segKey: '', phase: 'during', today, wantedDay: null }),
    )
    expect(result.current.currentDay).toBe(today)
    const before = renderHook(() =>
      useDayInView({ days: schedule.days, segKey: '', phase: 'before', today, wantedDay: null }),
    )
    expect(before.result.current.currentDay).toBe(schedule.days[0].date)
  })

  it('puts a deep-linked day at the top once', () => {
    const el = document.createElement('section')
    el.id = `day-${rel(1)}`
    el.scrollIntoView = vi.fn()
    document.body.append(el)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 0
    })
    const { rerender } = renderHook(() =>
      useDayInView({
        days: schedule.days,
        segKey: '',
        phase: 'during',
        today,
        wantedDay: rel(1),
      }),
    )
    rerender()
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1)
    el.remove()
  })
})
