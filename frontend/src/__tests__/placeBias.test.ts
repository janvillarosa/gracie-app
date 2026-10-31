import { describe, expect, it } from 'vitest'
import type { Booking, Place, Trip, TripTodo } from '../api/tripTypes'
import { dayBias } from '../lib/trips/placeBias'
import { biasBox, MAX_BIAS_SPAN } from '../lib/trips/placesSource'

const LISBON = { lat: 38.72, lng: -9.14 }
const PORTO = { lat: 41.15, lng: -8.61 }
const TOKYO = { lat: 35.68, lng: 139.65 }

const at = (p: { lat: number; lng: number }): Place => ({ ...p, source: 'pin' })
const todo = (day: string | null, p: { lat: number; lng: number }, time?: string): TripTodo => ({
  todo_id: `t-${day}-${p.lat}`,
  title: 'x',
  done: false,
  day,
  start_time: time,
  order: 0,
  category: 'sight',
  place: at(p),
})
const trip = (
  todos: TripTodo[] = [],
  bookings: Booking[] = [],
  destination: Place | null = at(LISBON),
): Pick<Trip, 'todos' | 'bookings' | 'destination' | 'stops'> => ({
  todos,
  bookings,
  destination,
  stops: [],
})

describe('dayBias', () => {
  it('leans on every placed item of the day, so a two-city day knows both', () => {
    const t = trip([
      todo('2026-05-02', PORTO, '18:00'),
      todo('2026-05-02', LISBON, '09:00'),
      todo('2026-05-03', TOKYO),
    ])
    expect(dayBias(t, '2026-05-02')).toEqual([LISBON, PORTO])
  })

  it('counts bookings that start or end on the day, including the arrival place', () => {
    const flight: Booking = {
      booking_id: 'b1',
      kind: 'train',
      title: 'Train',
      starts_at: '2026-05-02T09:00',
      ends_at: '2026-05-02T12:00',
      place: at(LISBON),
      end_place: at(PORTO),
    }
    expect(dayBias(trip([], [flight]), '2026-05-02')).toEqual([LISBON, PORTO])
  })

  it('starts an empty day where the closest earlier day ended', () => {
    const t = trip([
      todo('2026-05-01', LISBON, '09:00'),
      todo('2026-05-01', PORTO, '20:00'),
      todo('2026-05-09', TOKYO),
    ])
    expect(dayBias(t, '2026-05-03')).toEqual([PORTO])
  })

  it('falls back to the destination for Ideas and for a day before anything is placed', () => {
    const t = trip([todo('2026-05-05', PORTO)])
    expect(dayBias(t, null)).toEqual([LISBON])
    expect(dayBias(t, '2026-05-01')).toEqual([LISBON])
  })

  it('falls back to the first stop, and to nothing when the trip has no pin', () => {
    const stops = { ...trip([], [], null), stops: [at(PORTO)] }
    expect(dayBias(stops, null)).toEqual([PORTO])
    expect(dayBias(trip([], [], null), null)).toEqual([])
  })

  it('ignores address-only places', () => {
    const manual: TripTodo = {
      ...todo('2026-05-02', PORTO),
      place: { ...at(PORTO), source: 'manual' },
    }
    expect(dayBias(trip([manual]), '2026-05-02')).toEqual([LISBON])
  })
})

describe('biasBox with several points', () => {
  const centre = (b: { north: number; south: number; east: number; west: number }) => ({
    lat: (b.north + b.south) / 2,
    lng: (b.east + b.west) / 2,
  })

  it('covers both cities of a day, padded', () => {
    const b = biasBox([LISBON, PORTO])
    expect(b.south).toBeLessThan(38.7)
    expect(b.north).toBeGreaterThan(41.2)
    expect(b.west).toBeLessThan(-9.1)
    expect(b.east).toBeGreaterThan(-8.6)
  })

  it('keeps one point at the old 50 km box', () => {
    const b = biasBox([LISBON])
    expect(centre(b).lat).toBeCloseTo(38.7, 5)
    expect(centre(b).lng).toBeCloseTo(-9.1, 5)
    expect(b).toEqual(biasBox(LISBON))
  })

  it('leans on the last point alone when the day spans more than the cap', () => {
    const b = biasBox([LISBON, TOKYO])
    expect(b.east - b.west).toBeLessThan(MAX_BIAS_SPAN)
    expect(centre(b).lat).toBeCloseTo(35.7, 5)
    expect(centre(b).lng).toBeCloseTo(139.7, 5)
  })
})
