import { describe, expect, it } from 'vitest'
import type { Trip, TripTodo } from '../api/tripTypes'
import { IdbTripDB } from '../lib/trips/db'
import {
  addDays,
  buildSchedule,
  countdown,
  dateRange,
  eachDay,
  orderBetween,
  orderDay,
  orderForDrop,
  orderForTime,
  shortRange,
  parseQuickAdd,
  routeText,
  shortDay,
  tonightsStay,
  tripPhase,
  wallToUtc,
} from '../lib/trips/schedule'

const todo = (id: string, p: Partial<TripTodo> = {}): TripTodo => ({
  todo_id: id,
  title: id,
  done: false,
  order: 1,
  category: 'sight',
  ...p,
})

const trip = (p: Partial<Trip> = {}): Trip => ({
  trip_id: 'trip_a',
  title: 'Lisbon',
  start_date: '2026-10-22',
  end_date: '2026-10-25',
  tz: 'Europe/Lisbon',
  todos: [],
  bookings: [],
  version: 1,
  ...p,
})

describe('dates', () => {
  it('lists days and formats them', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ])
    expect(eachDay(null, null)).toEqual([])
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(shortDay('2026-10-24')).toBe('Sat 24')
    expect(dateRange('2026-10-22', '2026-10-30')).toBe('Thu 22 – Fri 30 Oct')
    expect(dateRange('2026-10-30', '2026-11-02')).toBe('Fri 30 Oct – Mon 2 Nov')
  })

  it('compares wall clocks in absolute time across zones', () => {
    // 07:05 in London (BST, +1) is 06:05Z; 09:40 in Lisbon (WEST, +1) is 08:40Z
    expect(wallToUtc('2026-10-24', '07:05', 'Europe/London')).toBe(Date.UTC(2026, 9, 24, 6, 5))
    expect(wallToUtc('2026-10-24', '09:40', 'Europe/Lisbon')).toBe(Date.UTC(2026, 9, 24, 8, 40))
    // After DST ends (31 Oct) London is +0
    expect(wallToUtc('2026-11-01', '09:00', 'Europe/London')).toBe(Date.UTC(2026, 10, 1, 9, 0))
  })
})

describe('buildSchedule', () => {
  it('orders a day by its manual order, and splits ideas and outside dates', () => {
    const t = trip({
      todos: [
        todo('c', { day: '2026-10-23', order: 2 }),
        todo('b', { day: '2026-10-23', start_time: '14:00', order: 3 }),
        todo('a', { day: '2026-10-23', start_time: '09:00', order: 1 }),
        todo('idea', { day: null }),
        todo('late', { day: '2026-12-01' }),
      ],
    })
    const s = buildSchedule(t)
    expect(s.days).toHaveLength(4)
    expect(s.days[1].entries.map((e) => e.id)).toEqual(['a', 'c', 'b'])
    expect(s.ideas.map((i) => i.todo_id)).toEqual(['idea'])
    expect(s.outside.map((e) => e.id)).toEqual(['late'])
  })

  it('flags empty days, overlaps in absolute time and todos outside the dates', () => {
    const t = trip({
      todos: [
        todo('a', { day: '2026-10-23', start_time: '10:00', duration_min: 120 }),
        todo('b', { day: '2026-10-23', start_time: '11:00' }),
        todo('x', { day: '2026-12-01' }),
        todo('y', { day: '2026-12-02' }),
      ],
    })
    const s = buildSchedule(t)
    expect(s.gaps.map((g) => g.text)).toEqual([
      '3 days have nothing planned',
      'Fri 23 has two things at the same time',
      '2 things are outside the trip dates',
    ])
    expect(s.gaps[0].target).toBe('day-2026-10-22')
  })

  it('does not call back-to-back stops an overlap, and compares across zones', () => {
    const t = trip({
      todos: [
        todo('a', {
          day: '2026-10-23',
          start_time: '10:00',
          duration_min: 60,
          tz: 'Europe/Lisbon',
        }),
        // 11:00 in Paris (+2) is 09:00 in Lisbon time: that is inside the first stop
        todo('b', { day: '2026-10-23', start_time: '11:00', tz: 'Europe/Paris' }),
      ],
    })
    expect(buildSchedule(t).gaps.some((g) => g.id.startsWith('overlap'))).toBe(true)
    const calm = trip({
      todos: [
        todo('a', { day: '2026-10-23', start_time: '10:00', duration_min: 60 }),
        todo('b', { day: '2026-10-23', start_time: '11:00' }),
      ],
    })
    expect(buildSchedule(calm).gaps.some((g) => g.id.startsWith('overlap'))).toBe(false)
  })

  it('puts bookings in the spine at their start and suggests a muted day label', () => {
    const t = trip({
      days: { '2026-10-22': 'Arrival' },
      bookings: [
        {
          booking_id: 'tbk_1',
          kind: 'train',
          title: 'Rossio to Sintra',
          starts_at: '2026-10-24T08:41',
          start_tz: 'Europe/Lisbon',
        },
        { booking_id: 'tbk_2', kind: 'other', title: 'No time' },
      ],
      todos: [
        todo('a', {
          day: '2026-10-24',
          place: { name: 'Pena', locality: 'Sintra', lat: 1, lng: 1, source: 'photon' },
        }),
        todo('b', {
          day: '2026-10-24',
          place: { name: 'Quinta', locality: 'Sintra', lat: 1, lng: 1, source: 'photon' },
        }),
      ],
    })
    const s = buildSchedule(t)
    const sat = s.days[2]
    expect(sat.entries[0]).toMatchObject({ kind: 'booking', id: 'tbk_1' })
    expect(sat.suggested).toBe('Sintra')
    expect(s.days[0]).toMatchObject({ label: 'Arrival', suggested: '' })
  })

  it('shows only ideas for a draft', () => {
    const s = buildSchedule(
      trip({ start_date: null, end_date: null, todos: [todo('i', { day: null })] }),
    )
    expect(s.days).toHaveLength(0)
    expect(s.ideas).toHaveLength(1)
  })
})

describe('phases and copy', () => {
  it('names the phase and countdown', () => {
    const t = trip()
    expect(tripPhase(t, '2026-10-01')).toBe('before')
    expect(countdown(t, '2026-10-01')).toBe('In 21 days')
    expect(countdown(t, '2026-10-21')).toBe('Tomorrow')
    expect(countdown(t, '2026-10-24')).toBe('Day 3 of 4')
    expect(countdown(t, '2026-10-27')).toBe('Ended 2 days ago')
    expect(tripPhase(trip({ start_date: null, end_date: null }), '2026-10-01')).toBe('draft')
  })

  it('finds tonight’s stay and builds the route text', () => {
    const t = trip({
      bookings: [
        {
          booking_id: 'tbk_s',
          kind: 'stay',
          title: 'Hotel',
          starts_at: '2026-10-22T15:00',
          ends_at: '2026-10-25T11:00',
        },
      ],
      stops: [
        { name: 'Lisbon', lat: 1, lng: 1, source: 'manual' },
        { name: 'Porto', lat: 2, lng: 2, source: 'manual' },
      ],
    })
    expect(tonightsStay(t, '2026-10-24')?.title).toBe('Hotel')
    expect(tonightsStay(t, '2026-10-25')).toBeUndefined()
    expect(routeText(t)).toBe('Lisbon → Porto')
    expect(
      routeText(trip({ destination: { name: 'Faro', lat: 1, lng: 1, source: 'photon' } })),
    ).toBe('Faro')
  })

  it('parses a time off the front of a quick add', () => {
    expect(parseQuickAdd('14:00 Pena Palace')).toEqual({
      start_time: '14:00',
      title: 'Pena Palace',
    })
    expect(parseQuickAdd('2pm Lunch')).toEqual({ start_time: '14:00', title: 'Lunch' })
    expect(parseQuickAdd('9:30am Train')).toEqual({ start_time: '09:30', title: 'Train' })
    expect(parseQuickAdd('Pastéis de Belém')).toEqual({ title: 'Pastéis de Belém' })
  })

  it('picks a midpoint order', () => {
    expect(orderBetween()).toBe(1)
    expect(orderBetween(2)).toBe(3)
    expect(orderBetween(undefined, 2)).toBe(1)
    expect(orderBetween(1, 2)).toBe(1.5)
  })
})

describe('IdbTripDB', () => {
  it('round-trips snapshots, ops and the device counter', async () => {
    const db = new IdbTripDB()
    const t = { ...trip(), room_id: 'r' }
    await db.putTrip(t)
    await db.appendOp(
      { v: 1, op_id: 'o1', client_id: 'c', seq: 7, at: 1, type: 'trip.update', trip_id: 'trip_a' },
      { client_id: 'c', seq: 7 },
    )
    await db.appendOp(
      { v: 1, op_id: 'o2', client_id: 'c', seq: 8, at: 1, type: 'trip.update', trip_id: 'trip_a' },
      { client_id: 'c', seq: 8 },
    )
    let loaded = await db.load('c')
    expect(loaded.trips[0].title).toBe('Lisbon')
    expect(loaded.outbox.map((o) => o.seq)).toEqual([7, 8])
    expect(loaded.meta).toEqual({ client_id: 'c', seq: 8 })
    await db.deleteOps(['o1'])
    await db.deleteTrip('trip_a')
    await db.putMeta({ client_id: 'c', seq: 9 })
    loaded = await db.load('c')
    expect(loaded.trips).toHaveLength(0)
    expect(loaded.outbox.map((o) => o.seq)).toEqual([8])
    expect(loaded.meta?.seq).toBe(9)
  })
})

describe('a day keeps its manual order', () => {
  const day = '2026-10-23'
  const t = (id: string, order: number, time?: string, tz?: string) =>
    todo(id, { day, order, start_time: time ?? null, tz })

  it('leaves an untimed todo between two timed ones where it was put', () => {
    const s = buildSchedule(trip({ todos: [t('a', 1, '10:00'), t('u', 1.5), t('b', 2, '12:00')] }))
    expect(s.days[1].entries.map((e) => e.id)).toEqual(['a', 'u', 'b'])
  })

  it('does not reorder timed todos by their time', () => {
    const s = buildSchedule(trip({ todos: [t('late', 1, '18:00'), t('early', 2, '09:00')] }))
    expect(s.days[1].entries.map((e) => e.id)).toEqual(['late', 'early'])
  })

  it('slots bookings at their time among the timed todos', () => {
    const s = buildSchedule(
      trip({
        todos: [t('a', 1, '09:00'), t('u', 2), t('b', 3, '15:00')],
        bookings: [
          {
            booking_id: 'tbk_x',
            kind: 'train',
            title: 'Train',
            starts_at: `${day}T11:00`,
            start_tz: 'Europe/Lisbon',
          },
        ],
      }),
    )
    expect(s.days[1].entries.map((e) => e.id)).toEqual(['a', 'tbk_x', 'u', 'b'])
    expect(orderDay([]).length).toBe(0)
  })

  it('places a todo by its time between the nearest timed neighbours', () => {
    const list = [t('a', 1, '10:00'), t('u', 2), t('b', 3, '14:00')]
    expect(orderForTime(list, day, '12:00', 'Europe/Lisbon', 'Europe/Lisbon')).toBe(2)
    // Before the first, after the last, and with nothing timed to place it against.
    expect(orderForTime(list, day, '08:00', 'Europe/Lisbon')).toBe(0)
    expect(orderForTime(list, day, '18:00', 'Europe/Lisbon')).toBe(4)
    expect(orderForTime([t('u', 1)], day, '12:00', 'Europe/Lisbon')).toBeUndefined()
  })

  it('places a time by absolute time across zones', () => {
    // 11:00 in Paris is 10:00 in Lisbon: it lands after the 09:30 Lisbon stop, before 12:00.
    const list = [t('a', 1, '09:30', 'Europe/Lisbon'), t('b', 2, '12:00', 'Europe/Lisbon')]
    expect(orderForTime(list, day, '11:00', 'Europe/Paris')).toBe(1.5)
  })

  it('places a dropped todo before or after the one it lands on', () => {
    const list = [t('a', 1), t('b', 2), t('c', 3)]
    expect(orderForDrop(list, 'b', true)).toBe(1.5)
    expect(orderForDrop(list, 'b', false)).toBe(2.5)
    expect(orderForDrop(list, 'a', true)).toBe(0)
    expect(orderForDrop(list, 'c', false)).toBe(4)
    expect(orderForDrop(list, 'zzz', true)).toBeUndefined()
  })

  it('writes a short range for a header line', () => {
    expect(shortRange('2026-10-22', '2026-10-30')).toBe('22–30 Oct')
    expect(shortRange('2026-10-30', '2026-11-02')).toBe('30 Oct – 2 Nov')
    expect(shortRange('2026-10-22', '2026-10-22')).toBe('22 Oct')
    expect(shortRange(null, null)).toBe('')
  })
})
