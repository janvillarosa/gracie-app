import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Trip } from '@api/tripTypes'
import { getTripStore } from '@lib/trips/store'
import { shortDay } from '@lib/trips/schedule'
import { server, tripServer } from '../testServer'
import {
  ME,
  MIA,
  ROOM,
  lisbonTrip,
  makeTrip,
  rel,
  renderTrips,
  resetTripsWorld,
  seed,
  setViewport,
  todo,
} from './trips.helpers'

const scrollIntoView = vi.fn()
const TRIP = lisbonTrip()
const open = (id = TRIP.trip_id) => renderTrips(`/app/trips/${id}`)
const deck = () => screen.findByRole('region', { name: 'Next stop' })
const serverTodos = () => tripServer.trips.get(TRIP.trip_id)?.todos ?? []
const order = (t: string) => serverTodos().find((x) => x.title === t)?.order as number
const rowTitles = () =>
  Array.from(document.querySelectorAll('.trip-row .trip-title')).map((e) => e.textContent)
const store = () =>
  getTripStore(`${ME}:${ROOM}`, () => {
    throw new Error('store should exist')
  })

beforeEach(async () => {
  await resetTripsWorld()
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
  setViewport('desktop')
})
afterEach(resetTripsWorld)

describe('The stack', () => {
  it('is a paper stack: the trip sheet, then Plan, Ideas and Bookings as pills', async () => {
    seed(TRIP)
    const { container } = open()
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
    expect(container.querySelector('.paper-stack .paper-meta')).not.toBeNull()
    expect(container.querySelector('.paper-stack .paper-list')).not.toBeNull()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Plan',
      'Ideas',
      'Bookings',
    ])
    expect(screen.getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps Notes, Packing and Trip settings behind the menu', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    expect(await screen.findByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Packing list')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Trip settings'))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/\/settings$/))
    expect(await screen.findByLabelText('Trip name')).toBeInTheDocument()
  })

  it('shows the ideas in their own tab', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Ideas' }))
    expect(await screen.findByText('Ginjinha tasting')).toBeInTheDocument()
    expect(screen.getByText('Day trip to Cascais')).toBeInTheDocument()
  })

  it('has no "things to look at" pill', async () => {
    seed(TRIP)
    open()
    await deck()
    expect(screen.queryByRole('button', { name: /to look at/ })).not.toBeInTheDocument()
  })

  it('has no count summaries in day headers', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Later today' })
    expect(screen.queryByText(/\d+ stops?/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ bookings?/)).not.toBeInTheDocument()
  })
})

describe('Overlaps', () => {
  // Tomorrow: Jerónimos 10:00 for two hours, then Pastéis at 11:00.
  const clashing = () => {
    const t = lisbonTrip()
    t.todos[7] = { ...t.todos[7], duration_min: 120 }
    t.todos.push(todo('11', 'Pastéis de Belém', { day: rel(1), order: 2, start_time: '11:00' }))
    return t
  }

  it('names the clash once under the day header and marks both rows', async () => {
    seed(clashing())
    open()
    const line = await screen.findByRole('button', {
      name: 'Jerónimos Monastery and Pastéis de Belém overlap at 11:00',
    })
    const day = line.closest('section') as HTMLElement
    expect(within(day).getAllByRole('button', { name: /overlap/ })).toHaveLength(1)
    for (const title of ['Jerónimos Monastery', 'Pastéis de Belém'])
      expect(within(day).getByText(title).closest('li')).toHaveClass('is-clash')
  })

  it('opens the later item with its time ready, and the line goes when the times stop overlapping', async () => {
    seed(clashing())
    open()
    await userEvent.click(
      await screen.findByRole('button', { name: /Jerónimos Monastery and Pastéis/ }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'Pastéis de Belém' })
    const time = within(sheet).getByLabelText('Time')
    expect(time).toHaveFocus()
    fireEvent.change(time, { target: { value: '12:30' } })
    fireEvent.blur(time)
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /overlap/ })).not.toBeInTheDocument(),
    )
  })

  it('never flags a day that is already over', async () => {
    const t = lisbonTrip()
    // Yesterday: two stops at the same time.
    t.todos[2] = { ...t.todos[2], start_time: '10:00' }
    seed(t)
    open()
    await deck()
    await userEvent.click(await screen.findByRole('button', { name: /2 days done/ }))
    await screen.findByRole('heading', { name: shortDay(rel(-1)) })
    expect(screen.queryByRole('button', { name: /overlap/ })).not.toBeInTheDocument()
  })

  it('puts a small amber dot on the day in the day list', async () => {
    seed(clashing())
    open()
    await userEvent.click(await screen.findByRole('button', { name: /Day 3 of 5/ }))
    const list = await screen.findByRole('list', { name: 'Days' })
    const row = within(list).getByRole('button', { name: new RegExp(shortDay(rel(1))) })
    expect(within(row).getByRole('img', { name: 'Two things overlap' })).toBeInTheDocument()
    expect(within(list).getAllByRole('img', { name: 'Two things overlap' })).toHaveLength(1)
  })
})

describe('Header day list', () => {
  it('opens a list of days from the header line and jumps to the one you pick', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: /Day 3 of 5/ }))
    const list = await screen.findByRole('list', { name: 'Days' })
    expect(within(list).getAllByRole('button')).toHaveLength(5)
    expect(within(list).getAllByText('All done')).toHaveLength(2)
    expect(within(list).getByText('Nothing planned')).toBeInTheDocument()
    scrollIntoView.mockClear()
    await userEvent.click(within(list).getByRole('button', { name: new RegExp(shortDay(rel(1))) }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(([...scrollIntoView.mock.contexts].pop() as HTMLElement).id).toBe(`day-${rel(1)}`)
  })

  it('shows a done day when it is picked', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: /Day 3 of 5/ }))
    const list = await screen.findByRole('list', { name: 'Days' })
    await userEvent.click(within(list).getByRole('button', { name: /Arrival/ }))
    expect(await screen.findByRole('heading', { name: shortDay(rel(-2)) })).toBeInTheDocument()
  })
})

describe('Next-stop deck', () => {
  const tick = async (card: HTMLElement, title: string) =>
    userEvent.click(within(card).getByRole('checkbox', { name: `${title}, done` }))

  it('shows the top stop big, a quiet subheading, and the rest as rows', async () => {
    seed(TRIP)
    open()
    const card = await deck()
    expect(within(card).getByText('Next stop')).toBeInTheDocument()
    expect(within(card).getByRole('heading', { name: 'Pena Palace' })).toBeInTheDocument()
    expect(within(card).getByText('10:15')).toBeInTheDocument()
    // The heading is only where to go; there is no "more today" line.
    expect(within(card).queryByText(/more today/)).not.toBeInTheDocument()
    // The checkbox sits beside the title; there is no Done, Go or Skip button.
    expect(within(card).getByRole('checkbox', { name: 'Pena Palace, done' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('img', { name: /Stop \d/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Later today' })).toBeInTheDocument()
    expect(rowTitles().slice(0, 3)).toEqual([
      'Lunch at Tascantiga',
      'Pack the daypack',
      'Buy souvenirs',
    ])
  })

  it('says "Anytime" for an untimed stop, and takes the first in the day’s order', async () => {
    const t = lisbonTrip()
    t.todos[5] = { ...t.todos[5], order: 0.5 } // "Pack the daypack", untimed, first
    seed(t)
    open()
    const card = await deck()
    expect(within(card).getByRole('heading', { name: 'Pack the daypack' })).toBeInTheDocument()
    expect(within(card).getByText('Anytime')).toBeInTheDocument()
  })

  it('names the linked booking under the title, and never guesses a link by name', async () => {
    const t = lisbonTrip()
    t.todos[3] = { ...t.todos[3], booking_id: t.bookings[0].booking_id }
    seed(t)
    open()
    const card = await deck()
    expect(within(card).getByRole('heading', { name: 'Pena Palace' })).toBeInTheDocument()
    expect(within(card).getByText('10:15 · London to Lisbon · Booked')).toBeInTheDocument()
    // The linked booking is not a card of its own, and its code waits behind a button.
    expect(within(card).getByRole('button', { name: 'Show code' })).toBeInTheDocument()
  })

  it('opens Maps from the one yellow key when the stop has a place', async () => {
    const t = lisbonTrip()
    t.todos[3] = {
      ...t.todos[3],
      place: { name: 'Pena Palace', lat: 38.78, lng: -9.39, source: 'photon' },
    }
    seed(t)
    open()
    const card = await deck()
    const link = within(card).getByRole('link', { name: 'Open Maps' })
    expect(link).toHaveAttribute('href', expect.stringContaining('38.78,-9.39'))
  })

  it('ticks the stop with its checkbox and deals the next card, announcing it', async () => {
    seed(TRIP)
    open()
    const card = await deck()
    await tick(card, 'Pena Palace')
    expect(
      await within(card).findByRole('heading', { name: 'Lunch at Tascantiga' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(serverTodos().find((t) => t.title === 'Pena Palace')?.done).toBe(true),
    )
    expect(document.body.textContent).toContain('Next stop: Lunch at Tascantiga, 12:30')
    await waitFor(() => expect(card.querySelector('article')).toHaveFocus())
  })

  it('deals at once with reduced motion', async () => {
    setViewport('desktop', { reduceMotion: true })
    seed(TRIP)
    open()
    const card = await deck()
    await tick(card, 'Pena Palace')
    expect(within(card).getByRole('heading', { name: 'Lunch at Tascantiga' })).toBeInTheDocument()
  })

  it('says gently that a timed stop was planned for earlier', async () => {
    const t = lisbonTrip()
    t.todos[3] = { ...t.todos[3], start_time: '00:01', tz: 'Pacific/Kiritimati', order: 1 }
    seed(t)
    open()
    expect(await screen.findByText('Planned for 00:01')).toBeInTheDocument()
  })

  it('uses the place as the heading, with the title as the first part of the subheading', async () => {
    const t = lisbonTrip()
    t.todos[4] = {
      ...t.todos[4],
      title: 'Lunch',
      place: { name: 'Tascantiga', lat: 38.8, lng: -9.38, source: 'photon' },
    }
    t.todos[3] = { ...t.todos[3], done: true }
    seed(t)
    open()
    const card = await deck()
    expect(within(card).getByRole('heading', { name: 'Tascantiga' })).toBeInTheDocument()
    expect(within(card).getByText('Lunch · 12:30')).toBeInTheDocument()
  })

  it('deals an unlinked booking as a card headed by its place, with the code behind a ticket slip', async () => {
    const t: Trip = lisbonTrip()
    t.bookings.push({
      booking_id: `tbk_${'9'.padStart(32, '0')}`,
      kind: 'train',
      title: 'Train to Sintra',
      confirmation_code: 'CP-77120',
      starts_at: `${rel(0)}T23:59`,
      start_tz: 'Europe/Lisbon',
      place: { name: 'Rossio station', lat: 38.714, lng: -9.1409, source: 'photon' },
      created_by: MIA,
    })
    seed(t)
    open()
    const card = await deck()
    await tick(card, 'Pena Palace')
    await within(card).findByRole('heading', { name: 'Lunch at Tascantiga' })
    await tick(card, 'Lunch at Tascantiga')
    expect(await within(card).findByRole('heading', { name: 'Rossio station' })).toBeInTheDocument()
    expect(within(card).getByText('23:59 · Train to Sintra · Booked')).toBeInTheDocument()
    // Never auto-revealed; nothing in the card moves when the slip opens.
    expect(screen.queryByText('CP-77120')).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Show code' }))
    expect(await screen.findByLabelText('Confirmation code for Train to Sintra')).toHaveTextContent(
      'CP-77120',
    )
    expect(within(card).queryByText('CP-77120')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy code for Train to Sintra' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('CP-77120')).not.toBeInTheDocument())
  })

  it('ends the day with the stamp, then points to tomorrow', async () => {
    seed(TRIP)
    open()
    const card = await deck()
    for (const title of [
      'Pena Palace',
      'Lunch at Tascantiga',
      'Pack the daypack',
      'Buy souvenirs',
    ]) {
      await tick(card, title)
      await waitFor(() => expect(serverTodos().find((x) => x.title === title)?.done).toBe(true), {
        timeout: 4000,
      })
    }
    expect(await within(card).findByText('That’s today')).toBeInTheDocument()
    expect(within(card).getByText(`Tomorrow: ${shortDay(rel(1))}`)).toBeInTheDocument()
    expect(within(card).getByText(/First stop Jerónimos Monastery at 10:00/)).toBeInTheDocument()
    expect(await within(card).findByText('Day done')).toBeInTheDocument()
    scrollIntoView.mockClear()
    await userEvent.click(within(card).getByRole('button', { name: 'See tomorrow' }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    // Today now sits with the other finished days.
    expect(await screen.findByRole('button', { name: /3 days done/ })).toBeInTheDocument()
  })

  it('opens the stop’s detail from its title', async () => {
    seed(TRIP)
    open()
    const card = await deck()
    await userEvent.click(within(card).getByRole('button', { name: 'Pena Palace' }))
    expect(await screen.findByRole('dialog', { name: 'Pena Palace' })).toBeInTheDocument()
  })

  it('has no deck before the trip', async () => {
    seed(
      makeTrip(8, {
        title: 'Later',
        start_date: rel(10),
        end_date: rel(12),
        todos: [todo('1', 'Fly out', { day: rel(10) })],
      }),
    )
    open(makeTrip(8).trip_id)
    await screen.findByRole('heading', { name: 'Later' })
    expect(screen.queryByRole('region', { name: 'Next stop' })).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: shortDay(rel(10)) })).toBeInTheDocument()
  })
})

describe('Opening a trip', () => {
  it('opens at the top, with no ?day= written to the address bar', async () => {
    seed(TRIP)
    open()
    await deck()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(window.location.search).not.toContain('day=')
  })

  it('scrolls to a day only when the link carried one', async () => {
    seed(TRIP)
    renderTrips(`/app/trips/${TRIP.trip_id}?day=${rel(2)}`)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(([...scrollIntoView.mock.contexts].pop() as HTMLElement).id).toBe(`day-${rel(2)}`)
  })
})

describe('Days', () => {
  it('folds finished days into one line at the top of the plan, and shows them on tap', async () => {
    seed(TRIP)
    open()
    const line = await screen.findByRole('button', { name: /2 days done/ })
    expect(line).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Castelo de São Jorge')).not.toBeInTheDocument()
    await userEvent.click(line)
    expect(await screen.findByText('Castelo de São Jorge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide done days' })).toBeInTheDocument()
  })

  it('keeps a past day with open items as a normal section', async () => {
    const t = lisbonTrip()
    t.todos[2] = todo('3', 'Lunch at Time Out Market', {
      day: rel(-1),
      done: false,
      order: 2,
      start_time: '13:00',
    })
    seed(t)
    open()
    expect(await screen.findByRole('heading', { name: shortDay(rel(-1)) })).toBeInTheDocument()
    expect(screen.getByText('Lunch at Time Out Market')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 day done/ })).toBeInTheDocument()
  })

  it('says an empty day is empty, and offers no add control of its own', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: shortDay(rel(2)) })
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText(/^Add (a|an|to) /)).toHaveLength(1)
  })

  it('draws one friendly sheet when nothing is planned yet', async () => {
    seed(makeTrip(7, { title: 'Draft' }))
    open(makeTrip(7).trip_id)
    expect(await screen.findByRole('heading', { name: 'Where to first?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'When are you going?' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/\/settings$/))
    expect(await screen.findByLabelText('Trip name')).toBeInTheDocument()
  })

  it('puts things dated outside the trip in their own section', async () => {
    const t = lisbonTrip()
    t.todos.push(todo('11', 'Christmas market', { day: rel(40) }))
    seed(t)
    open()
    const section = await screen.findByRole('region', { name: 'Outside trip dates' })
    expect(within(section).getByText('Christmas market')).toBeInTheDocument()
    expect(within(section).getByText(/^These are dated outside /)).toBeInTheDocument()
  })
})

describe('Rows', () => {
  it('keeps rows quiet: a title, a time when it has one, a small dot for the kind', async () => {
    seed(TRIP)
    open()
    const row = (await screen.findByText('Lunch at Tascantiga')).closest('li') as HTMLElement
    expect(within(row).getByText('12:30')).toBeInTheDocument()
    expect(within(row).queryByText('Sight')).not.toBeInTheDocument()
    expect(within(row).getByRole('img', { name: 'Sight' })).toBeInTheDocument()
    // Delete is a hover button on desktop (and a swipe on touch), never a chip.
    expect(
      within(row).getByRole('button', { name: 'Delete Lunch at Tascantiga' }),
    ).toBeInTheDocument()
  })

  it('swipes left to delete with an Undo, like a list', async () => {
    class TouchPointer extends MouseEvent {
      pointerType = 'touch'
      pointerId = 1
    }
    seed(TRIP)
    open()
    const row = (await screen.findByText('Buy souvenirs')).closest('li') as HTMLElement
    const slide = row.querySelector('.item-slide') as Element
    const at = (type: string, x: number) =>
      fireEvent(slide, new TouchPointer(type, { bubbles: true, clientX: x, clientY: 20 }))
    at('pointerdown', 300)
    at('pointermove', 280)
    at('pointermove', 200)
    at('pointermove', 150)
    at('pointerup', 150)
    expect(await screen.findByText(/Deleted Buy souvenirs/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Buy souvenirs' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Buy souvenirs' })).toBeInTheDocument()
  })

  it('deletes from the hover button too', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Buy souvenirs' }))
    expect(await screen.findByText(/Deleted Buy souvenirs/)).toBeInTheDocument()
  })

  it('has no empty time column on untimed rows, or on a day with no times', async () => {
    const t = lisbonTrip()
    t.todos[7] = { ...t.todos[7], start_time: null } // tomorrow's only todo
    seed(t)
    open()
    const row = (await screen.findByText('Pack the daypack')).closest('li') as HTMLElement
    expect(row.querySelector('.trip-time')).toBeNull()
    await screen.findByRole('heading', { name: shortDay(rel(1)) })
    const day = document.getElementById(`day-${rel(1)}`) as HTMLElement
    expect(day.querySelector('.trip-time')).toBeNull()
  })

  it('opens the sheet on click: a heading to type in, quiet rows, no field labels', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Lunch at Tascantiga' }))
    const panel = await screen.findByRole('dialog', { name: 'Lunch at Tascantiga' })
    // The title is one borderless heading, not repeated in a header.
    const title = within(panel).getByLabelText('Title')
    expect(title).toHaveValue('Lunch at Tascantiga')
    expect(within(panel).getByRole('button', { name: /Add a place/ })).toBeInTheDocument()
    expect(within(panel).getByLabelText('Day')).toHaveValue(rel(0))
    expect(within(panel).getByRole('group', { name: 'Category' })).toBeInTheDocument()
    expect(within(panel).getByPlaceholderText('Add a note')).toBeInTheDocument()
    // No Save button, and a quiet Delete at the bottom.
    expect(within(panel).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    await userEvent.clear(title)
    await userEvent.type(title, 'Lunch in Sintra')
    await userEvent.tab()
    expect(within(panel).getByText(/Added by Mia/)).toBeInTheDocument()
    await waitFor(() => expect(serverTodos().some((x) => x.title === 'Lunch in Sintra')).toBe(true))
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Lunch/ })).not.toBeInTheDocument(),
    )
  })

  it('moves a row with the keyboard through Move to…', async () => {
    seed(TRIP)
    open()
    const move = await screen.findByRole('button', { name: 'Move Buy souvenirs to…' })
    move.focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('menu', { name: 'Move Buy souvenirs to' })
    await userEvent.keyboard('{End}{Enter}')
    await waitFor(() =>
      expect(serverTodos().find((x) => x.title === 'Buy souvenirs')?.day ?? null).toBeNull(),
    )
    await waitFor(() => expect(document.body.textContent).toContain('Moved Buy souvenirs to Ideas'))
  })

  it('reorders with Alt+Arrow, timed or not, and announces it', async () => {
    seed(TRIP)
    open()
    ;(await screen.findByRole('button', { name: 'Buy souvenirs' })).focus()
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() =>
      expect(rowTitles().slice(0, 3)).toEqual([
        'Lunch at Tascantiga',
        'Buy souvenirs',
        'Pack the daypack',
      ]),
    )
    expect(document.body.textContent).toContain('Moved Buy souvenirs up, position 3 of 4')
    // A timed row moves too: the day's order is the manual order.
    screen.getByRole('button', { name: 'Lunch at Tascantiga' }).focus()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await waitFor(() =>
      expect(rowTitles().slice(0, 3)).toEqual([
        'Buy souvenirs',
        'Lunch at Tascantiga',
        'Pack the daypack',
      ]),
    )
  })

  it('keeps an untimed item exactly where it is put between two timed ones', async () => {
    const t = lisbonTrip()
    // Pena (10:15, deck) then Lunch (12:30), Pack, Souvenirs: put Pack above Lunch.
    seed(t)
    open()
    ;(await screen.findByRole('button', { name: 'Pack the daypack' })).focus()
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}')
    await waitFor(() =>
      expect(rowTitles().slice(0, 3)).toEqual([
        'Pack the daypack',
        'Lunch at Tascantiga',
        'Buy souvenirs',
      ]),
    )
    await waitFor(() => {
      expect(order('Pack the daypack')).toBeGreaterThan(order('Pena Palace'))
      expect(order('Pack the daypack')).toBeLessThan(order('Lunch at Tascantiga'))
    })
    // Still there after the server's copy comes back.
    await act(async () => {
      await store().flush()
    })
    expect(rowTitles().slice(0, 3)).toEqual([
      'Pack the daypack',
      'Lunch at Tascantiga',
      'Buy souvenirs',
    ])
  })

  it('places an item by its time when a time is set', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Buy souvenirs' }))
    const panel = await screen.findByRole('dialog', { name: 'Buy souvenirs' })
    await userEvent.click(within(panel).getByRole('button', { name: '+ Time' }))
    await userEvent.type(within(panel).getByLabelText('Time'), '11:00')
    await userEvent.tab()
    // Between Pena Palace (10:15, the deck) and Lunch (12:30).
    await waitFor(() =>
      expect(rowTitles().slice(0, 3)).toEqual([
        'Buy souvenirs',
        'Lunch at Tascantiga',
        'Pack the daypack',
      ]),
    )
    await waitFor(() => {
      expect(order('Buy souvenirs')).toBeGreaterThan(order('Pena Palace'))
      expect(order('Buy souvenirs')).toBeLessThan(order('Lunch at Tascantiga'))
    })
  })

  it('shows a conflict note on the row, with See theirs', async () => {
    const t = lisbonTrip()
    t.todos[4] = { ...t.todos[4], updated_by: MIA }
    seed(t)
    open()
    await screen.findByText('Lunch at Tascantiga')
    const id = TRIP.todos[4].todo_id
    act(() => {
      const s = store()
      s['notes'] = { [id]: { key: id, tripId: TRIP.trip_id, fields: ['title'] } }
      s['emit']()
    })
    expect(await screen.findByText('Mia changed this after your offline edit')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'See theirs' }))
    expect(await screen.findByRole('dialog', { name: 'Lunch at Tascantiga' })).toBeInTheDocument()
  })

  it('shows who changed a row recently as a small initial', async () => {
    const t = lisbonTrip()
    t.todos[4] = { ...t.todos[4], updated_by: MIA, updated_at: new Date().toISOString() }
    seed(t)
    open()
    expect(await screen.findByRole('img', { name: 'Changed by Mia' })).toBeInTheDocument()
  })

  it('deletes from the detail, with Undo', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Buy souvenirs' }))
    const panel = await screen.findByRole('dialog', { name: 'Buy souvenirs' })
    await userEvent.click(within(panel).getByRole('button', { name: /Delete/ }))
    expect(await screen.findByText(/Deleted Buy souvenirs/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Buy souvenirs' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('button', { name: 'Buy souvenirs' })).toBeInTheDocument()
  })
})

describe('The add bar', () => {
  it('is the only add control, with the day as a chip, and adds to that day', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    expect(screen.getAllByPlaceholderText(/^Add (a|an|to) /)).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Adding to Today/ })).toBeInTheDocument()
    await userEvent.type(field, '14:00 Quinta da Regaleira{Enter}')
    const row = (await screen.findByRole('button', { name: 'Quinta da Regaleira' })).closest(
      'li',
    ) as HTMLElement
    expect(within(row).getByText('14:00')).toBeInTheDocument()
    await waitFor(() => {
      const t = serverTodos().find((x) => x.title === 'Quinta da Regaleira')
      expect(t?.day).toBe(rel(0))
      expect(t?.start_time).toBe('14:00')
    })
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('places a timed add by its time among the timed ones', async () => {
    seed(TRIP)
    open()
    await userEvent.type(
      await screen.findByRole('combobox', { name: 'Add to today' }),
      '11:00 Coffee{Enter}',
    )
    await waitFor(() => expect(rowTitles().slice(0, 2)).toEqual(['Coffee', 'Lunch at Tascantiga']))
  })

  it('lets the chip pick another day or Ideas from the same day list', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.click(screen.getByRole('button', { name: /Adding to Today/ }))
    const list = await screen.findByRole('list', { name: 'Add to' })
    await userEvent.click(within(list).getByRole('button', { name: 'Ideas' }))
    const field = await screen.findByRole('combobox', { name: 'Add an idea' })
    await userEvent.type(field, 'Fado night{Enter}')
    await waitFor(() => {
      const t = serverTodos().find((x) => x.title === 'Fado night')
      expect(t).toBeDefined()
      expect(t?.day ?? null).toBeNull()
    })
  })

  it('targets Ideas while the Ideas tab is open', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Ideas' }))
    expect(await screen.findByRole('combobox', { name: 'Add an idea' })).toBeInTheDocument()
  })

  it('offers the full editor only once something is typed, and it is the same editor', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    expect(screen.queryByRole('button', { name: 'Add with details' })).not.toBeInTheDocument()
    await userEvent.type(field, '16:00 Ginjinha stop')
    await userEvent.click(screen.getByRole('button', { name: 'Add with details' }))
    const panel = await screen.findByRole('dialog', { name: 'Ginjinha stop' })
    expect(within(panel).getByLabelText('Title')).toHaveValue('Ginjinha stop')
    expect(within(panel).getByLabelText('Time')).toHaveValue('16:00')
    await waitFor(() => expect(serverTodos().some((x) => x.title === 'Ginjinha stop')).toBe(true))
  })

  it('opens the editor on Shift+Enter too', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.type(field, 'Sunset spot{Shift>}{Enter}{/Shift}')
    expect(await screen.findByRole('dialog', { name: 'Sunset spot' })).toBeInTheDocument()
  })

  it('starts the booking form from the Bookings tab', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: 'Bookings' }))
    // One add bar, and on Bookings it opens the booking sheet at once.
    expect(screen.queryByRole('button', { name: 'Add booking' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Add a booking' }))
    const panel = await screen.findByRole('dialog', { name: 'New booking' })
    expect(within(panel).getByLabelText('Title')).toHaveValue('')
  })

  it('focuses on n or /, but not while typing elsewhere', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.keyboard('n')
    expect(field).toHaveFocus()
    field.blur()
    await userEvent.keyboard('/')
    expect(field).toHaveFocus()
    await userEvent.keyboard('n')
    expect(field).toHaveValue('n')
  })

  it('suggests places as slips and adds the chosen one', async () => {
    seed(TRIP)
    open()
    await userEvent.type(await screen.findByRole('combobox', { name: 'Add to today' }), 'Pena')
    await userEvent.click(await screen.findByRole('option', { name: /Pena Palace/ }))
    await waitFor(() => {
      const added = serverTodos().filter((x) => x.title === 'Pena Palace' && x.place)
      expect(added.length).toBe(1)
    })
  })

  it('falls back when place search is unavailable, and the typed text still adds', async () => {
    tripServer.degradedPlaces = true
    seed(TRIP)
    open()
    await userEvent.type(await screen.findByRole('combobox', { name: 'Add to today' }), 'Lisbon')
    expect(
      await screen.findByText('Search is unavailable. Drop a pin or type the address.'),
    ).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Lisbon' })).toBeInTheDocument()
  })

  it('is gone on a finished trip until you choose to edit', async () => {
    seed(makeTrip(5, { title: 'Old trip', start_date: rel(-10), end_date: rel(-8) }))
    open(makeTrip(5).trip_id)
    expect(await screen.findByRole('button', { name: 'Edit anyway' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/^Add/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit anyway' }))
    expect(await screen.findByPlaceholderText(/^Add/)).toBeInTheDocument()
  })
})

describe('Sync and states', () => {
  it('shows the offline note while ops cannot be sent, and keeps edits', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Later today' })
    server.use(
      http.post('/api/rooms/:roomId/trips/ops', () => HttpResponse.error()),
      http.post('/api/rooms/:roomId/trips/sync', () => HttpResponse.error()),
    )
    await userEvent.type(
      screen.getByRole('combobox', { name: 'Add to today' }),
      'Offline idea{Enter}',
    )
    expect(await screen.findByText('Saved on this device · syncs when online')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Offline idea' })).toBeInTheDocument()
  })

  it('shows a deleted trip with a Restore banner', async () => {
    seed(TRIP)
    open()
    await screen.findByText('Lunch at Tascantiga')
    const srvTrip = tripServer.trips.get(TRIP.trip_id)
    if (srvTrip) srvTrip.deleted_by = MIA
    await act(async () => {
      await store().flush()
    })
    expect(await screen.findByText('Mia deleted this trip.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(screen.queryByText('Mia deleted this trip.')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(tripServer.trips.get(TRIP.trip_id)?.deleted_by).toBeUndefined())
  })

  it('says a trip is missing instead of showing a blank page', async () => {
    open(makeTrip(99).trip_id)
    expect(await screen.findByRole('heading', { name: /can’t find this trip/ })).toBeInTheDocument()
  })
})

describe('Phone', () => {
  beforeEach(() => setViewport('phone'))

  it('opens today and tomorrow, and folds later days to a header line', async () => {
    seed(TRIP)
    open()
    expect(await screen.findByRole('heading', { name: 'Later today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: shortDay(rel(1)) })).toBeInTheDocument()
    const folded = screen.getByRole('button', { name: `Show ${shortDay(rel(2))}` })
    expect(folded).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(folded)
    expect(await screen.findByRole('heading', { name: shortDay(rel(2)) })).toBeInTheDocument()
    // No map numbers in the rows while the map is closed.
    expect(document.querySelector('.trip-pinno')).toBeNull()
  })

  it('opens the day list in a bottom sheet from the header line', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: /Day 3 of 5/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('list', { name: 'Days' })).toBeInTheDocument()
    scrollIntoView.mockClear()
    await userEvent.click(within(sheet).getByRole('button', { name: new RegExp(shortDay(rel(2))) }))
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    // Picking a folded day opens it.
    expect(await screen.findByRole('heading', { name: shortDay(rel(2)) })).toBeInTheDocument()
  })

  it('has no date strip', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: 'Later today' })
    expect(screen.queryByRole('tablist', { name: 'Days' })).not.toBeInTheDocument()
  })

  it('keeps a single add bar and no keyboard shortcut', async () => {
    seed(TRIP)
    open()
    expect(await screen.findAllByPlaceholderText(/^Add (a|an|to) /)).toHaveLength(1)
    await userEvent.keyboard('n')
    expect(screen.getByRole('combobox', { name: 'Add to today' })).not.toHaveFocus()
  })

  it('loads the map only after its key is pressed, and has no bottom bar', async () => {
    const t = lisbonTrip()
    t.todos[4] = {
      ...t.todos[4],
      place: { name: 'Tascantiga', lat: 38.8, lng: -9.38, source: 'photon' },
    }
    seed(t)
    open()
    // A round key in the pill row, labelled with the day. No full-width bar.
    const key = await screen.findByRole('button', { name: /^Show map for / })
    expect(screen.queryByText(/^Map · /)).not.toBeInTheDocument()
    expect(document.querySelector('.trip-bottom')).toBeNull()
    expect(screen.queryByText('Offline map')).not.toBeInTheDocument()
    await userEvent.click(key)
    expect(await screen.findByText(/Map preview|Offline map/)).toBeInTheDocument()
  })

  it('hides the map key until the trip has a place', async () => {
    seed(TRIP)
    open()
    await deck()
    expect(screen.queryByRole('button', { name: /^Show map for / })).not.toBeInTheDocument()
  })

  it('opens an item as a bottom sheet', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Lunch at Tascantiga' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Lunch at Tascantiga')
  })

  it('shows the deck first on the phone too', async () => {
    seed(TRIP)
    open()
    expect(await deck()).toBeInTheDocument()
  })
})
