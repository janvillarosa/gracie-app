import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dayAtLine, readingLine, useDayInView } from '@pages/trip/useDayInView'

describe('readingLine', () => {
  it('stays put until the last stretch, then slides to the bottom edge', () => {
    expect(readingLine(56, 600, 900)).toBe(56)
    expect(readingLine(56, 600, 544)).toBe(56)
    expect(readingLine(56, 600, 300)).toBe(300)
    expect(readingLine(56, 600, 0)).toBe(600)
  })
})

describe('dayAtLine', () => {
  const cards = [
    { date: '2026-11-01', top: -400 },
    { date: '2026-11-02', top: 120 },
    { date: '2026-11-03', top: 480 },
  ]
  it('is the last card whose top is at or above the line', () => {
    expect(dayAtLine(cards, 56)).toBe('2026-11-01')
    expect(dayAtLine(cards, 120)).toBe('2026-11-02')
    expect(dayAtLine(cards, 600)).toBe('2026-11-03')
  })
  it('is the first card when the line is above them all, and nothing with no cards', () => {
    expect(dayAtLine(cards.slice(1), 10)).toBe('2026-11-02')
    expect(dayAtLine([], 10)).toBeNull()
  })
})

describe('useDayInView at the end of the list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('reaches the last days once the pane can scroll no further', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    // A 600px pane holding three days; the last two are short and sit below the reading line.
    const scroller = document.createElement('div')
    const box = (top: number) => ({ top }) as DOMRect
    scroller.getBoundingClientRect = () => box(0)
    Object.defineProperty(scroller, 'clientHeight', { value: 600 })
    Object.defineProperty(scroller, 'scrollHeight', { value: 1600 })
    const tops: Record<string, number> = { '2026-11-01': 0, '2026-11-02': 900, '2026-11-03': 1300 }
    for (const date of Object.keys(tops)) {
      const el = document.createElement('section')
      el.className = 'trip-day'
      el.dataset.day = date
      el.getBoundingClientRect = () => box(tops[date] - scroller.scrollTop)
      scroller.append(el)
    }
    document.body.append(scroller)
    const days = Object.keys(tops).map((date) => ({ date })) as never
    const { result } = renderHook(() =>
      useDayInView({
        days,
        segKey: 'k',
        phase: 'before',
        today: '2026-10-31',
        wantedDay: null,
        getScroller: () => scroller,
      }),
    )
    const scrollTo = (y: number) =>
      act(() => {
        scroller.scrollTop = y
        scroller.dispatchEvent(new Event('scroll'))
      })

    // Scrolled to the very bottom: the last day, though it never reaches the top line.
    await scrollTo(1000)
    await waitFor(() => expect(result.current.currentDay).toBe('2026-11-03'))
    // Part way into the last stretch: the line has slid onto the middle day.
    await scrollTo(700)
    await waitFor(() => expect(result.current.currentDay).toBe('2026-11-02'))
  })
})
