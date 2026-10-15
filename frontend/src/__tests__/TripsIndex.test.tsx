import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTrip, rel, renderTrips, resetTripsWorld, seed, todo } from './trips.helpers'
import { tripServer } from '../testServer'

beforeEach(resetTripsWorld)
afterEach(resetTripsWorld)

describe('Trips index', () => {
  it('groups trips into Now, Upcoming, Drafts and Past', async () => {
    seed(makeTrip(1, { title: 'Lisbon & Porto', start_date: rel(-1), end_date: rel(5) }))
    seed(makeTrip(2, { title: 'Weekend in Ghent', start_date: rel(30), end_date: rel(32) }))
    seed(makeTrip(3, { title: 'Somewhere warm', todos: [todo('1', 'Madeira', { day: null })] }))
    seed(makeTrip(4, { title: 'Bruges day trip', start_date: rel(-40), end_date: rel(-40) }))
    renderTrips('/app/trips')

    for (const [group, title] of [
      ['Now', 'Lisbon & Porto'],
      ['Upcoming', 'Weekend in Ghent'],
      ['Drafts', 'Somewhere warm'],
      ['Past', 'Bruges day trip'],
    ]) {
      const region = await screen.findByRole('region', { name: group })
      expect(within(region).getByRole('link', { name: new RegExp(title) })).toBeInTheDocument()
    }
    expect(screen.getByText('Day 2 of 7')).toBeInTheDocument()
    expect(screen.getByText('In 30 days')).toBeInTheDocument()
  })

  it('creates a trip from a title alone and opens it', async () => {
    renderTrips('/app/trips')
    await userEvent.click(await screen.findByRole('button', { name: /new trip/i }))
    await userEvent.type(screen.getByLabelText('Title'), 'Autumn in Vienna')
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }))

    expect(await screen.findByRole('heading', { name: 'Autumn in Vienna' })).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toMatch(/^\/app\/trips\/trip_[0-9a-f]{32}$/)
    // The create op reaches the server.
    await waitFor(() => expect(tripServer.trips.size).toBe(1))
    expect([...tripServer.trips.values()][0].fields.title).toBe('Autumn in Vienna')
  })

  it('creates a trip with dates and refuses an end before the start', async () => {
    renderTrips('/app/trips')
    await userEvent.click(await screen.findByRole('button', { name: /new trip/i }))
    await userEvent.type(screen.getByLabelText('Title'), 'Short break')
    await userEvent.type(screen.getByLabelText(/Starts/), rel(10))
    await userEvent.clear(screen.getByLabelText(/Ends/))
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/both dates/i)
  })

  it('shows a calm empty state', async () => {
    renderTrips('/app/trips')
    expect(await screen.findByText(/No trips yet/)).toBeInTheDocument()
  })
})
