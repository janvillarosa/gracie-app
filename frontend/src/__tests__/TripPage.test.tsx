import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(async () => {
  await resetTripsWorld()
  scrollIntoView.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
  setViewport('desktop')
})
afterEach(resetTripsWorld)

describe('Trip screen structure', () => {
  it('offers Plan, Ideas and Bookings as real tabs, with the rest behind a menu', async () => {
    seed(TRIP)
    open()
    const tabs = await screen.findByRole('tablist', { name: 'Trip sections' })
    const names = within(tabs)
      .getAllByRole('tab')
      .map((t) => t.textContent)
    expect(names).toEqual(['Plan', 'Ideas (2)', 'Bookings (1)'])
    expect(within(tabs).getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'More trip options' }))
    expect(await screen.findByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Packing list')).toBeInTheDocument()
    expect(screen.getByText('Trip details')).toBeInTheDocument()
  })

  it('moves tabs with the arrow keys', async () => {
    seed(TRIP)
    open()
    const plan = await screen.findByRole('tab', { name: 'Plan' })
    plan.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /Ideas/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens trip details in a modal', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'More trip options' }))
    await userEvent.click(await screen.findByText('Trip details'))
    const dialog = await screen.findByRole('dialog', { name: 'Trip details' })
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Lisbon & Porto')
    expect(within(dialog).getByText('Route')).toBeInTheDocument()
  })

  it('lists the ideas under the Ideas tab and docks them over the map on desktop', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: /Ideas/ }))
    const panel = await screen.findByRole('dialog', { name: 'Ideas (2)' })
    expect(within(panel).getByText('Ginjinha tasting')).toBeInTheDocument()
    // The plan stays visible beside it, so ideas can still go onto days.
    expect(screen.getByText('Pena Palace')).toBeInTheDocument()
  })
})

describe('Days', () => {
  it('folds finished days into slim lines, and merges consecutive ones', async () => {
    seed(TRIP)
    open()
    const line = await screen.findByRole('button', { name: /2 days done · 3 items/ })
    expect(line).toHaveAttribute('aria-expanded', 'false')
    // Today and the next day stay open as cards.
    expect(screen.getByRole('heading', { name: shortDay(rel(0)) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: shortDay(rel(1)) })).toBeInTheDocument()
    expect(screen.queryByText('Castelo de São Jorge')).not.toBeInTheDocument()

    await userEvent.click(line)
    // Opening the merged line lists each day's own slim line.
    expect(await screen.findByRole('button', { name: /Arrival · 1 done/ })).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: new RegExp(`${shortDay(rel(-1))} · 2 done`) }),
    )
    expect(await screen.findByText('Castelo de São Jorge')).toBeInTheDocument()
    // Folding it again brings the slim line back.
    await userEvent.click(screen.getByRole('button', { name: `Collapse ${shortDay(rel(-1))}` }))
    await waitFor(() => expect(screen.queryByText('Castelo de São Jorge')).not.toBeInTheDocument())
  })

  it('keeps a past day with open items as a normal card', async () => {
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
    // The other past day is still done.
    expect(screen.getByRole('button', { name: /Arrival · 1 done/ })).toBeInTheDocument()
  })

  it('shows "Day done" when the last item is ticked, then folds the day', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: shortDay(rel(0)) })
    for (const name of [
      'Pena Palace',
      'Lunch at Tascantiga',
      'Pack the daypack',
      'Buy souvenirs',
    ]) {
      await userEvent.click(screen.getByRole('checkbox', { name: `${name}, done` }))
    }
    expect(await screen.findByText('Day done')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Day done')).not.toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(await screen.findByRole('button', { name: /3 days done · 7 items/ })).toBeInTheDocument()
    expect(document.body.textContent).toContain(`done, folded`)
  })

  it('folds at once with reduced motion, and unfolds when an item is unticked', async () => {
    setViewport('desktop', { reduceMotion: true })
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: shortDay(rel(0)) })
    for (const name of [
      'Pena Palace',
      'Lunch at Tascantiga',
      'Pack the daypack',
      'Buy souvenirs',
    ]) {
      await userEvent.click(screen.getByRole('checkbox', { name: `${name}, done` }))
    }
    expect(screen.queryByText('Day done')).not.toBeInTheDocument()
    const line = await screen.findByRole('button', { name: /3 days done/ })
    await userEvent.click(line)
    await userEvent.click(
      await screen.findByRole('button', { name: new RegExp(`${shortDay(rel(0))}.*4 done`) }),
    )
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Buy souvenirs, done' }))
    // Unticking unfolds the day again.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: shortDay(rel(0)) })).toBeInTheDocument(),
    )
  })

  it('says an empty day is empty and offers no add control of its own', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: shortDay(rel(2)) })
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText(/^Add (to|an)/)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^\+ ?Add/ })).not.toBeInTheDocument()
  })
})

describe('Rows and the item detail', () => {
  it('keeps rows quiet: title, time and place, with no category chip text', async () => {
    seed(TRIP)
    open()
    const row = (await screen.findByText('Pena Palace')).closest('li') as HTMLElement
    expect(within(row).getByText('10:15')).toBeInTheDocument()
    expect(within(row).queryByText('Sight')).not.toBeInTheDocument()
    expect(within(row).getByRole('img', { name: 'Sight' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('opens the detail on click, saves edits through the outbox and closes with Escape', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Pena Palace' }))
    const panel = await screen.findByRole('dialog', { name: 'Pena Palace' })
    const title = within(panel).getByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Pena Palace and park')
    await userEvent.tab()
    expect(within(panel).getByText(/Added by Mia/)).toBeInTheDocument()

    await waitFor(() => {
      const t = tripServer.trips
        .get(TRIP.trip_id)
        ?.todos.find((x) => x.title === 'Pena Palace and park')
      expect(t).toBeDefined()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Pena Palace/ })).not.toBeInTheDocument(),
    )
  })

  it('shows a booking with its code large and copyable', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: /2 days done/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Arrival · 1 done/ }))
    await userEvent.click(await screen.findByRole('button', { name: /London to Lisbon/ }))
    const panel = await screen.findByRole('dialog', { name: 'London to Lisbon' })
    expect(within(panel).getByText('TP1355')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Copy code/ })).toBeInTheDocument()
    expect(within(panel).getByText(/07:05 London → 09:40 Lisbon/)).toBeInTheDocument()
  })

  it('moves a row with the keyboard through Move to…', async () => {
    seed(TRIP)
    open()
    const move = await screen.findByRole('button', { name: 'Move Buy souvenirs to…' })
    move.focus()
    await userEvent.keyboard('{Enter}')
    const menu = await screen.findByRole('menu', { name: 'Move Buy souvenirs to' })
    // The menu opens on the first day other than the current one; End goes to Ideas.
    expect(within(menu).getByRole('menuitem', { name: /Ideas/ })).toBeInTheDocument()
    await userEvent.keyboard('{End}{Enter}')
    await waitFor(() => {
      const t = [...tripServer.trips.values()][0]?.todos.find((x) => x.title === 'Buy souvenirs')
      expect(t?.day ?? null).toBeNull()
    })
    await waitFor(() => expect(document.body.textContent).toContain('Moved Buy souvenirs to Ideas'))
  })

  it('reorders untimed rows with Alt+Arrow and announces it', async () => {
    seed(TRIP)
    open()
    const titles = () =>
      screen
        .getAllByRole('button', { name: /^(Pack the daypack|Buy souvenirs)$/ })
        .map((b) => b.textContent)
    await screen.findByRole('button', { name: 'Pack the daypack' })
    expect(titles()).toEqual(['Pack the daypack', 'Buy souvenirs'])
    screen.getByRole('button', { name: 'Pack the daypack' }).focus()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await waitFor(() => expect(titles()).toEqual(['Buy souvenirs', 'Pack the daypack']))
    expect(document.body.textContent).toContain('Moved Pack the daypack down, position 4 of 4')
  })

  it('says why a timed row will not reorder', async () => {
    seed(TRIP)
    open()
    ;(await screen.findByRole('button', { name: 'Pena Palace' })).focus()
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await waitFor(() => expect(document.body.textContent).toContain('stay in time order'))
  })

  it('shows a conflict note on the row, with See theirs', async () => {
    const t = lisbonTrip()
    t.todos[3] = { ...t.todos[3], updated_by: MIA }
    seed(t)
    open()
    await screen.findByText('Pena Palace')
    const store = getTripStore(`${ME}:${ROOM}`, () => {
      throw new Error('store should exist')
    })
    const id = TRIP.todos[3].todo_id
    act(() => {
      store['notes'] = { [id]: { key: id, tripId: TRIP.trip_id, fields: ['title'] } }
      store['emit']()
    })
    expect(await screen.findByText('Mia changed this after your offline edit')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'See theirs' }))
    await waitFor(() =>
      expect(
        screen.queryByText('Mia changed this after your offline edit'),
      ).not.toBeInTheDocument(),
    )
    expect(await screen.findByRole('dialog', { name: 'Pena Palace' })).toBeInTheDocument()
  })

  it('shows who changed a row recently as a small initial', async () => {
    const t = lisbonTrip()
    t.todos[3] = { ...t.todos[3], updated_by: MIA, updated_at: new Date().toISOString() }
    seed(t)
    open()
    expect(await screen.findByRole('img', { name: 'Changed by Mia' })).toBeInTheDocument()
  })
})

describe('The one add bar', () => {
  it('has a single add control, targeted at today, and adds to that day', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    expect(screen.getAllByPlaceholderText(/^Add (to|an)/)).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Add to' })).toHaveValue(rel(0))
    await userEvent.type(field, '14:00 Quinta da Regaleira{Enter}')
    const row = (await screen.findByRole('button', { name: 'Quinta da Regaleira' })).closest(
      'li',
    ) as HTMLElement
    expect(within(row).getByText('14:00')).toBeInTheDocument()
    await waitFor(() => {
      const t = tripServer.trips
        .get(TRIP.trip_id)
        ?.todos.find((x) => x.title === 'Quinta da Regaleira')
      expect(t?.day).toBe(rel(0))
      expect(t?.start_time).toBe('14:00')
    })
    // The new row scrolls into view.
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('lets the target switch pick another day or Ideas', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Add to' }), 'Ideas')
    const field = await screen.findByRole('combobox', { name: 'Add an idea' })
    await userEvent.type(field, 'Fado night{Enter}')
    await waitFor(() => {
      const t = tripServer.trips.get(TRIP.trip_id)?.todos.find((x) => x.title === 'Fado night')
      expect(t).toBeDefined()
      expect(t?.day ?? null).toBeNull()
    })
  })

  it('targets Ideas while the Ideas tab is active', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('tab', { name: /Ideas/ }))
    expect(await screen.findByRole('combobox', { name: 'Add an idea' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Add to' })).toHaveValue('ideas')
  })

  it('focuses on n or /, but not while typing elsewhere', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.keyboard('n')
    expect(field).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    field.blur()
    await userEvent.keyboard('/')
    expect(field).toHaveFocus()
    // Typing an n in the field types it.
    await userEvent.keyboard('n')
    expect(field).toHaveValue('n')
  })

  it('falls back when place search is unavailable', async () => {
    tripServer.degradedPlaces = true
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.type(field, 'Lisbon')
    expect(
      await screen.findByText('Search is unavailable. Drop a pin or type the address.'),
    ).toBeInTheDocument()
    // The typed text still adds.
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: 'Lisbon' })).toBeInTheDocument()
  })

  it('suggests places as slips and adds the chosen one', async () => {
    seed(TRIP)
    open()
    const field = await screen.findByRole('combobox', { name: 'Add to today' })
    await userEvent.type(field, 'Pena')
    const slip = await screen.findByRole('option', { name: /Pena Palace/ })
    await userEvent.click(slip)
    await waitFor(() => {
      const added = tripServer.trips
        .get(TRIP.trip_id)
        ?.todos.filter((x) => x.title === 'Pena Palace' && x.place)
      expect(added?.length).toBe(1)
    })
  })

  it('is hidden on a finished trip until you choose to edit', async () => {
    seed(makeTrip(5, { title: 'Old trip', start_date: rel(-10), end_date: rel(-8) }))
    open(makeTrip(5).trip_id)
    expect(await screen.findByRole('button', { name: 'Edit anyway' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/^Add/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit anyway' }))
    expect(await screen.findByPlaceholderText(/^Add/)).toBeInTheDocument()
  })
})

describe('Gaps, sync and states', () => {
  it('summarises gaps in one pill and scrolls to each from a popover', async () => {
    seed(TRIP)
    open()
    const pill = await screen.findByRole('button', { name: /to sort/ })
    await userEvent.click(pill)
    const item = await screen.findByRole('button', { name: '1 day empty' })
    scrollIntoView.mockClear()
    await userEvent.click(item)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    const target = [...scrollIntoView.mock.contexts].pop() as HTMLElement
    expect(target.id).toBe(`day-${rel(2)}`)
  })

  it('shows the offline note while ops cannot be sent, and keeps edits', async () => {
    seed(TRIP)
    open()
    await screen.findByRole('heading', { name: shortDay(rel(0)) })
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
    await screen.findByText('Pena Palace')
    const srvTrip = tripServer.trips.get(TRIP.trip_id)
    if (srvTrip) srvTrip.deleted_by = MIA
    const store = getTripStore(`${ME}:${ROOM}`, () => {
      throw new Error('store should exist')
    })
    await act(async () => {
      await store.flush()
    })
    expect(await screen.findByText('Mia deleted this trip.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(screen.queryByText('Mia deleted this trip.')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(tripServer.trips.get(TRIP.trip_id)?.deleted_by).toBeUndefined())
  })

  it('draws a draft with only ideas and a nudge to add dates', async () => {
    seed(
      makeTrip(6, {
        title: 'Somewhere warm',
        todos: [todo('1', 'Madeira levadas', { day: null })],
      }),
    )
    open(makeTrip(6).trip_id)
    expect(await screen.findByText(/No dates yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add dates' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Add an idea' })).toBeInTheDocument()
  })

  it('puts todos dated outside the trip in their own section', async () => {
    const t = lisbonTrip()
    t.todos.push(todo('11', 'Christmas market', { day: rel(40) }))
    seed(t)
    open()
    const section = await screen.findByRole('region', { name: 'Outside trip dates' })
    expect(within(section).getByText('Christmas market')).toBeInTheDocument()
  })

  it('says a trip is missing instead of showing a blank page', async () => {
    open(makeTrip(99).trip_id)
    expect(await screen.findByRole('heading', { name: /can’t find this trip/ })).toBeInTheDocument()
  })

  it('lets someone delete an item with Undo', async () => {
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

describe('Phone', () => {
  beforeEach(() => setViewport('phone'))

  it('opens only today as a card, with the rest as summary cards and slim lines', async () => {
    seed(TRIP)
    open()
    expect(await screen.findByRole('heading', { name: shortDay(rel(0)) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Expand ${shortDay(rel(1))}` })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: /2 days done/ })).toBeInTheDocument()
    // No map numbers in the rows while the map is closed.
    expect(screen.queryByText('1', { selector: '.trip-pinno' })).not.toBeInTheDocument()
  })

  it('has a date strip where done days show a tick and tapping one opens it', async () => {
    seed(TRIP)
    open()
    const strip = await screen.findByRole('tablist', { name: 'Days' })
    const tabs = within(strip).getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    expect(tabs[0]).toHaveAccessibleName(/done/)
    scrollIntoView.mockClear()
    await userEvent.click(tabs[1])
    await waitFor(() => expect(screen.getByText('Castelo de São Jorge')).toBeInTheDocument())
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    // Arrow keys move between days.
    tabs[3].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tabs[4]).toHaveFocus()
  })

  it('keeps a single add bar with the target switch at the bottom', async () => {
    seed(TRIP)
    open()
    expect(await screen.findAllByPlaceholderText(/^Add (to|an)/)).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Add to' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'n' })
    // No keyboard shortcut on the phone.
    expect(screen.getByRole('combobox', { name: 'Add to today' })).not.toHaveFocus()
  })

  it('loads the map only after the sheet is pulled up', async () => {
    seed(TRIP)
    open()
    const handle = await screen.findByRole('button', { name: /^Map ·/ })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Offline map')).not.toBeInTheDocument()
    await userEvent.click(handle)
    expect(await screen.findByText('Offline map')).toBeInTheDocument()
  })

  it('opens an item as a bottom sheet', async () => {
    seed(TRIP)
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Pena Palace' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Pena Palace')
  })
})
