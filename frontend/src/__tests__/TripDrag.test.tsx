import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { message } from 'antd'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '@api/tripTypes'
import { IDEA_TIP_KEY } from '@components/trips/IdeasPanel'
import {
  EDGE_ZONE,
  MAX_SPEED,
  MIN_SPEED,
  dropHint,
  edgeScroll,
  scrollSpeed,
} from '@lib/trips/dragDrop'
import { buildSchedule, findClash } from '@lib/trips/schedule'
import { useTripDrag } from '../pages/trip/useTripDrag'
import { tripServer } from '../testServer'
import {
  MIA,
  lisbonTrip,
  makeTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
  todo,
} from './trips.helpers'

const A = rel(1)
const B = rel(2)
const trip = (todos: Trip['todos'] = []): Trip =>
  makeTrip(3, { start_date: rel(0), end_date: rel(8), todos })

// Toasts are global and outlive a test: always take the newest Undo. (Never message.destroy():
// it leaves antd's holder unusable for the tests after it.)
const newestUndo = async () => (await screen.findAllByRole('button', { name: 'Undo' })).slice(-1)[0]

describe('auto-scroll speed', () => {
  it('is nothing in the middle, 2 at the rim and 24 at the edge, easing in between', () => {
    expect(edgeScroll(400, 0, 800)).toBe(0)
    expect(edgeScroll(800 - EDGE_ZONE, 0, 800)).toBe(0)
    expect(edgeScroll(800 - EDGE_ZONE + 1, 0, 800)).toBeCloseTo(MIN_SPEED, 0)
    expect(edgeScroll(800, 0, 800)).toBe(MAX_SPEED)
    expect(edgeScroll(0, 0, 800)).toBe(-MAX_SPEED)
    expect(edgeScroll(EDGE_ZONE - 1, 0, 800)).toBeCloseTo(-MIN_SPEED, 0)
    // Eased: half way in is well under half the top speed.
    expect(scrollSpeed(0.5)).toBeLessThan((MIN_SPEED + MAX_SPEED) / 2)
    expect(scrollSpeed(0.5)).toBeGreaterThan(MIN_SPEED)
    // Past the edge it stays at the top speed; before the rim it is the floor.
    expect(scrollSpeed(3)).toBe(MAX_SPEED)
    expect(scrollSpeed(-1)).toBe(MIN_SPEED)
  })

  it('leaves room for a sticky footer: the zone is above it', () => {
    // The add bar covers the bottom 60px of an 800px window: the zone is 644-704.
    expect(edgeScroll(660, 0, 740)).toBeGreaterThan(0)
    expect(edgeScroll(600, 0, 740)).toBe(0)
  })
})

describe('where a drop lands', () => {
  const t = trip([
    todo('1', 'One', { day: A, order: 1, start_time: '09:00' }),
    todo('2', 'Two', { day: A, order: 2 }),
    todo('3', 'Three', { day: A, order: 3, start_time: '18:00' }),
    todo('4', 'Idea', { day: null, order: 1 }),
    todo('5', 'Timed idea', { day: null, order: 2, start_time: '12:00' }),
    todo('6', 'Other', { day: B, order: 1 }),
  ])
  const id = (n: string) => `ttd_${n.padStart(32, '0')}`

  it('puts an untimed idea exactly where the line is: before or after the row under the pointer', () => {
    const before = dropHint(t, id('4'), `row:${id('2')}`)
    expect(before).toMatchObject({ day: A, anchor: { id: id('2'), before: true } })
    expect(before?.label).toBeUndefined()
    // Between One (order 1) and Two (order 2).
    expect(before?.order).toBeGreaterThan(1)
    expect(before?.order).toBeLessThan(2)
  })

  it('puts it at the end of a day dropped on the day itself, or on its date in the rail', () => {
    for (const over of [`day:${A}`, `rail:${A}`]) {
      const h = dropHint(t, id('4'), over)
      expect(h).toMatchObject({ day: A, anchor: { id: id('3'), before: false } })
      expect(h?.order).toBeGreaterThan(3)
    }
    // An empty day: no row to sit beside.
    const empty = dropHint(t, id('4'), `day:${rel(5)}`)
    expect(empty).toMatchObject({ day: rel(5), order: 1 })
    expect(empty?.anchor).toBeUndefined()
  })

  it('puts a timed idea at its time, wherever the pointer is, and says so', () => {
    // 12:00 goes between 09:00 (One) and 18:00 (Three): before Two? Two is untimed and sits
    // between them in the manual order, so the line is before Three.
    for (const over of [`row:${id('1')}`, `row:${id('3')}`, `day:${A}`, `rail:${A}`]) {
      const h = dropHint(t, id('5'), over)
      expect(h?.day).toBe(A)
      expect(h?.label).toBe('at 12:00')
      expect(h?.order).toBeGreaterThan(1)
      expect(h?.order).toBeLessThan(3)
      expect(h?.anchor?.before).toBe(true)
    }
  })

  it('has nowhere to land on itself or on something that is not a target', () => {
    expect(dropHint(t, id('4'), `row:${id('4')}`)).toBeNull()
    expect(dropHint(t, id('4'), 'nope')).toBeNull()
  })

  it('drops back on Ideas at the end of the Ideas', () => {
    const h = dropHint(t, id('1'), 'ideas')
    expect(h).toMatchObject({ day: null })
    expect(h?.order).toBeGreaterThan(2)
  })
})

describe('the drag, as a hook', () => {
  const t = trip([
    todo('1', 'One', { day: A, order: 1 }),
    todo('2', 'Idea', {
      day: null,
      order: 1,
      place: { name: 'Fado', lat: 38.7, lng: -9.1, source: 'pin' },
    }),
  ])
  const id = (n: string) => `ttd_${n.padStart(32, '0')}`
  const setup = (closed = new Set<string>()) => {
    const store = { updateTodo: vi.fn() }
    const ctx = { current: { showDay: vi.fn(), entered: vi.fn() } }
    const props = {
      trip: t,
      store: store as never,
      ctx: ctx as never,
      announce: vi.fn(),
      isClosed: (d: string) => closed.has(d),
      openDay: vi.fn(),
      foldDay: vi.fn(),
      currentDay: rel(0) as string | null,
      setCurrentDay: vi.fn(),
      setPreview: vi.fn(),
    }
    const hook = renderHook(() => useTripDrag(props))
    return { ...hook, props, store, ctx }
  }
  const over = (active: string, target: string) =>
    ({ active: { id: active }, over: { id: target } }) as unknown as DragOverEvent
  const end = (active: string, target: string | null) =>
    ({ active: { id: active }, over: target ? { id: target } : null }) as unknown as DragEndEvent

  beforeEach(() => {
    // Only the timeouts: faking rAF and the clock too leaks into other files' focus handling.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Toasts are not what these are about, and antd's message holder must never be built while
    // the timers are fake (it would stay broken for every later test).
    vi.spyOn(message, 'open').mockReturnValue((() => {}) as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the idea’s place as a preview while held, and clears it after', () => {
    const { result, props } = setup()
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    expect(props.setPreview).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Fado' }))
    act(() => result.current.onDragEnd(end(id('2'), null)))
    expect(props.setPreview).toHaveBeenLastCalledWith(null)
  })

  it('follows the day under the pointer on the map, after a short pause (not every pixel)', () => {
    const { result, props } = setup()
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragOver(over(id('2'), `day:${A}`)))
    expect(props.setCurrentDay).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(160)
    })
    expect(props.setCurrentDay).toHaveBeenCalledWith(A)
  })

  it('opens a folded day held under the pointer for 600ms, and folds it again after the drop', () => {
    const { result, props } = setup(new Set([A]))
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragOver(over(id('2'), `day:${A}`)))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(props.openDay).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(props.openDay).toHaveBeenCalledWith(A)
    act(() => result.current.onDragEnd(end(id('2'), `day:${A}`)))
    act(() => {
      vi.advanceTimersByTime(5)
    })
    expect(props.foldDay).toHaveBeenCalledWith(A)
  })

  it('does not open a day the pointer only passed over', () => {
    const { result, props } = setup(new Set([A]))
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragOver(over(id('2'), `day:${A}`)))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    act(() => result.current.onDragOver(over(id('2'), `day:${B}`)))
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(props.openDay).not.toHaveBeenCalledWith(A)
  })

  it('moves the item on a drop, and says so with an Undo that puts it back', async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    const { result, store, ctx, props } = setup()
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragEnd(end(id('2'), `day:${A}`)))
    expect(store.updateTodo).toHaveBeenCalledWith(
      t.trip_id,
      id('2'),
      expect.objectContaining({ day: A }),
    )
    expect(ctx.current.entered).toHaveBeenCalledWith(id('2'))
    expect(props.announce).toHaveBeenCalledWith(expect.stringMatching(/^Added to .*: Idea$/))
    const undo = await newestUndo()
    expect(undo.closest('.ant-message')).toHaveTextContent(/Added to /)
    await userEvent.click(undo)
    // Back to Ideas, at its old position.
    expect(store.updateTodo).toHaveBeenLastCalledWith(t.trip_id, id('2'), {
      day: null,
      order: 1,
    })
  })

  it('cancels: nothing moves, the map returns to where it was, the preview goes', () => {
    const { result, store, props } = setup()
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragOver(over(id('2'), `day:${B}`)))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(props.setCurrentDay).toHaveBeenCalledWith(B)
    act(() => result.current.onDragCancel())
    expect(store.updateTodo).not.toHaveBeenCalled()
    expect(props.setCurrentDay).toHaveBeenLastCalledWith(rel(0))
    expect(props.setPreview).toHaveBeenLastCalledWith(null)
    expect(result.current.dragging).toBeNull()
  })

  it('a drop outside any target cancels too', () => {
    const { result, store, props } = setup()
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragEnd(end(id('2'), null)))
    expect(store.updateTodo).not.toHaveBeenCalled()
    expect(props.setCurrentDay).toHaveBeenLastCalledWith(rel(0))
  })

  it('drops from the date rail onto a day without scrolling it into view', () => {
    const { result, store, ctx } = setup()
    act(() => result.current.onDragStart({ active: { id: id('2') } } as never))
    act(() => result.current.onDragEnd(end(id('2'), `rail:${B}`)))
    expect(store.updateTodo).toHaveBeenCalledWith(
      t.trip_id,
      id('2'),
      expect.objectContaining({ day: B }),
    )
    // The entrance must not scroll the page: the row is told to arrive quietly.
    expect(ctx.current.entered).toHaveBeenCalled()
  })
})

describe('ideas on a desk: delete, hint, touch', () => {
  beforeEach(async () => {
    await resetTripsWorld()
    Element.prototype.scrollIntoView = vi.fn()
    setViewport('desktop')
    try {
      localStorage.removeItem(IDEA_TIP_KEY)
    } catch {}
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await resetTripsWorld()
  })
  const open = () => {
    const t = lisbonTrip()
    t.todos.push(
      todo('21', 'Tram 28 early', { day: null, order: 3 }),
      todo('22', 'Cabo da Roca', { day: null, order: 4 }),
      todo('23', 'Pink Street drinks', { day: null, order: 5 }),
    )
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    return t
  }
  const ideaRow = async (title: string) => {
    const col = await screen.findByRole('complementary', { name: 'Ideas' })
    return (await within(col).findByText(title)).closest('li') as HTMLElement
  }
  const server = (t: Trip, title: string) =>
    tripServer.trips.get(t.trip_id)?.todos.find((x) => x.title === title)

  it('deletes with the trash, behind an Undo toast and no confirm', async () => {
    const t = open()
    const row = await ideaRow('Ginjinha tasting')
    await userEvent.click(within(row).getByRole('button', { name: 'Delete Ginjinha tasting' }))
    expect((await screen.findAllByText(/Deleted Ginjinha tasting/)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Gone from the column at once, and the count says so.
    const col = screen.getByRole('complementary', { name: 'Ideas' })
    expect(within(col).queryByText('Ginjinha tasting')).not.toBeInTheDocument()
    expect(within(col).getByText('Ideas · 4')).toBeInTheDocument()
    await userEvent.click(await newestUndo())
    expect(await within(col).findByText('Ginjinha tasting')).toBeInTheDocument()
    expect(server(t, 'Ginjinha tasting')).toBeDefined()
  })

  it('deletes with Delete or Backspace on a focused idea, behind the same Undo', async () => {
    open()
    const row = await ideaRow('Day trip to Cascais')
    const main = row.querySelector('.trip-main') as HTMLElement
    main.focus()
    await userEvent.keyboard('{Delete}')
    expect((await screen.findAllByText(/Deleted Day trip to Cascais/)).length).toBeGreaterThan(0)
    await userEvent.click(await newestUndo())
    const col = screen.getByRole('complementary', { name: 'Ideas' })
    const back = await within(col).findByText('Day trip to Cascais')
    ;(back.closest('li')?.querySelector('.trip-main') as HTMLElement).focus()
    await userEvent.keyboard('{Backspace}')
    expect(await screen.findAllByText(/Deleted Day trip to Cascais/)).not.toHaveLength(0)
  })

  it('does not delete on Delete from a day row (only ideas go with a key)', async () => {
    open()
    const btn = await screen.findByRole('button', { name: 'Lunch at Tascantiga' })
    btn.focus()
    await userEvent.keyboard('{Delete}')
    expect(screen.queryByText(/Deleted Lunch at Tascantiga/)).not.toBeInTheDocument()
  })

  it('deletes with a swipe to the left, behind the same Undo', async () => {
    open()
    const row = await ideaRow('Tram 28 early')
    class TouchPointer extends MouseEvent {
      pointerType = 'touch'
      pointerId = 1
    }
    const slide = row.querySelector('.item-slide') as Element
    const at = (type: string, x: number) =>
      fireEvent(slide, new TouchPointer(type, { bubbles: true, clientX: x, clientY: 20 }))
    at('pointerdown', 250)
    at('pointermove', 230)
    at('pointermove', 150)
    at('pointermove', 90)
    at('pointerup', 90)
    expect((await screen.findAllByText(/Deleted Tram 28 early/)).length).toBeGreaterThan(0)
    expect((await screen.findAllByRole('button', { name: 'Undo' })).length).toBeGreaterThan(0)
  })

  it('says how to move an idea on the first hover, once', async () => {
    open()
    const row = await ideaRow('Cabo da Roca')
    expect(localStorage.getItem(IDEA_TIP_KEY)).toBeNull()
    fireEvent.mouseOver(row)
    expect(
      await screen.findByText('Drag onto a day, or press Enter to pick one'),
    ).toBeInTheDocument()
    expect(localStorage.getItem(IDEA_TIP_KEY)).toBe('1')
  })

  it('does not say it again once it has been seen', async () => {
    localStorage.setItem(IDEA_TIP_KEY, '1')
    open()
    const row = await ideaRow('Cabo da Roca')
    fireEvent.mouseOver(row)
    expect(screen.queryByText(/press Enter to pick one/)).not.toBeInTheDocument()
  })

  it('stays quiet (and does not break) when storage is off', async () => {
    const real = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      if (k === IDEA_TIP_KEY) throw new Error('off')
      return real.call(this, k)
    })
    open()
    const row = await ideaRow('Cabo da Roca')
    expect(() => fireEvent.mouseOver(row)).not.toThrow()
    expect(screen.queryByText(/press Enter to pick one/)).not.toBeInTheDocument()
  })

  it('gives an idea a grip that shows at rest, and a title tooltip for long names', async () => {
    open()
    const row = await ideaRow('Ginjinha tasting')
    expect(row.querySelector('.trip-grip.is-lead')).not.toBeNull()
    expect(within(row).getByText('Ginjinha tasting')).toHaveAttribute('title', 'Ginjinha tasting')
  })

  it('moves an idea onto a day by keyboard: Move to… lists the days, Enter places it', async () => {
    const t = open()
    const row = await ideaRow('Pink Street drinks')
    const add = within(row).getByRole('button', { name: 'Add Pink Street drinks to a day' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Move Pink Street drinks to' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.length).toBeGreaterThan(3)
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(server(t, 'Pink Street drinks')?.day).toBeTruthy())
  })
})

describe('overlaps and finished things', () => {
  const clashing = () =>
    trip([
      todo('1', 'First', { day: A, order: 1, start_time: '11:00', duration_min: 60 }),
      todo('2', 'Second', { day: A, order: 2, start_time: '11:30' }),
    ])
  const clashOf = (t: Trip, nowMs?: number) =>
    buildSchedule(t, nowMs).days.find((d) => d.date === A)?.clash

  it('flags two timed items that run into each other', () => {
    expect(clashOf(clashing())?.ids).toHaveLength(2)
  })

  it('clears when either one is done, and returns when it is unticked', () => {
    const t = clashing()
    for (const i of [0, 1]) {
      const done = { ...t, todos: t.todos.map((x, j) => (j === i ? { ...x, done: true } : x)) }
      expect(clashOf(done)).toBeUndefined()
    }
    expect(clashOf(t)).toBeDefined()
  })

  it('ignores a booking that has passed', () => {
    const t = clashing()
    t.bookings = [
      {
        booking_id: `tbk_${'1'.padStart(32, '0')}`,
        kind: 'ticket',
        title: 'Timed entry',
        created_by: MIA,
        starts_at: `${A}T11:15`,
        ends_at: `${A}T11:45`,
        start_tz: t.tz,
        end_tz: t.tz,
      },
    ]
    const entries = buildSchedule(t).days.find((d) => d.date === A)?.entries ?? []
    expect(findClash(entries)).toBeDefined()
    // Long after it ended: the booking and the clash with it are gone (the todos still clash).
    const later = Date.parse(`${A}T20:00:00Z`)
    const c = findClash(
      entries.filter((e) => e.kind === 'booking'),
      later,
    )
    expect(c).toBeUndefined()
  })

  it('ticking one of two clashing todos clears the warning from the line, the rows and the day list', async () => {
    await resetTripsWorld()
    setViewport('desktop')
    Element.prototype.scrollIntoView = vi.fn()
    // A trip that starts tomorrow: no Next stop card takes the first row.
    const day = rel(1)
    const t = makeTrip(4, {
      title: 'Clash',
      start_date: day,
      end_date: rel(4),
      todos: [
        todo('1', 'Museum', { day, order: 1, start_time: '23:00', duration_min: 60 }),
        todo('2', 'Dinner', { day, order: 2, start_time: '23:30' }),
      ],
    })
    seed(t)
    renderTrips(`/app/trips/${t.trip_id}`)
    const line = await screen.findByRole('button', {
      name: /Museum and Dinner overlap|Dinner starts before/,
    })
    expect(line).toBeInTheDocument()
    const rows = () => document.querySelectorAll('.trip-days-col .trip-row.is-clash')
    expect(rows().length).toBe(2)
    const tick = screen.getByRole('checkbox', { name: 'Museum, done' })
    // The checkbox is never disabled for a warning.
    expect(tick).toBeEnabled()
    await userEvent.click(tick)
    await waitFor(() => expect(rows().length).toBe(0))
    expect(screen.queryByRole('button', { name: /overlap|starts before/ })).not.toBeInTheDocument()
    expect(document.querySelector('.trip-time-flag')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Museum, done' }))
    await waitFor(() => expect(rows().length).toBe(2))
    expect(
      await screen.findByRole('button', { name: /Museum and Dinner overlap|Dinner starts before/ }),
    ).toBeInTheDocument()
  })
})
