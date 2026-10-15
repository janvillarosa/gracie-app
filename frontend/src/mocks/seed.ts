// Synthetic demo data for the dev worker. Everything here is made up: "Lisbon & Porto" is a
// plausible itinerary, not a real booking. Dates are relative to today so the trip can be
// shown before, during or after.
import type { Booking, Place, Trip, TripCategory, TripTodo } from '../api/tripTypes'
import { addDays } from '../lib/trips/schedule'

export const ME = 'user_jan'
export const MIA = 'user_mia'
export type Phase = 'before' | 'during' | 'after'

const hex = (n: number) => n.toString(16).padStart(32, '0')
const TZ = 'Europe/Lisbon'

const P = (name: string, lat: number, lng: number, locality: string, address = ''): Place => ({
  name,
  address: address || undefined,
  locality,
  lat,
  lng,
  tz: TZ,
  source: 'photon',
})

const L = {
  miradouro: P('Miradouro da Senhora do Monte', 38.7196, -9.1327, 'Lisbon', 'Largo Monte, Lisbon'),
  fado: P('Clube de Fado', 38.7117, -9.1285, 'Lisbon', 'Rua de São João da Praça, Lisbon'),
  castelo: P('Castelo de São Jorge', 38.7139, -9.1334, 'Lisbon'),
  se: P('Sé de Lisboa', 38.7099, -9.133, 'Lisbon'),
  jeronimos: P('Jerónimos Monastery', 38.6979, -9.2065, 'Lisbon'),
  pasteis: P('Pastéis de Belém', 38.6975, -9.2032, 'Lisbon'),
  torre: P('Belém Tower', 38.6916, -9.216, 'Lisbon'),
  maat: P('MAAT', 38.6957, -9.1943, 'Lisbon'),
  timeout: P('Time Out Market', 38.7068, -9.1458, 'Lisbon'),
  bertrand: P('Livraria Bertrand', 38.7107, -9.1424, 'Lisbon'),
  santajusta: P('Santa Justa Lift', 38.7121, -9.1394, 'Lisbon'),
  comercio: P('Praça do Comércio', 38.7075, -9.1364, 'Lisbon'),
  lx: P('LX Factory', 38.7033, -9.1783, 'Lisbon'),
  gulbenkian: P('Gulbenkian Museum', 38.7377, -9.1536, 'Lisbon'),
  pena: P('Pena Palace', 38.7876, -9.3906, 'Sintra', 'Estrada da Pena, Sintra'),
  regaleira: P('Quinta da Regaleira', 38.7963, -9.3957, 'Sintra'),
  piriquita: P('Piriquita', 38.7969, -9.3877, 'Sintra'),
  tasca: P('Tascantiga (synthetic)', 38.7978, -9.387, 'Sintra'),
  sintraStation: P('Sintra station', 38.7978, -9.3868, 'Sintra'),
  lello: P('Livraria Lello', 41.1469, -8.6149, 'Porto'),
  ribeira: P('Ribeira', 41.1406, -8.613, 'Porto'),
  ponte: P('Dom Luís I Bridge', 41.1397, -8.6095, 'Porto'),
  gaia: P('Port cellars in Gaia', 41.137, -8.613, 'Vila Nova de Gaia'),
  clerigos: P('Clérigos Tower', 41.1458, -8.6139, 'Porto'),
  santiago: P('Café Santiago', 41.1478, -8.6122, 'Porto'),
  serralves: P('Serralves Museum', 41.1595, -8.6597, 'Porto'),
  sao_bento: P('São Bento station', 41.1457, -8.6104, 'Porto'),
  foz: P('Foz do Douro', 41.15, -8.676, 'Porto'),
}

type Row = [
  day: number | null,
  time: string | null,
  min: number | null,
  title: string,
  cat: TripCategory,
  place?: Place,
  by?: string,
]

const ROWS: Row[] = [
  [0, '13:45', 60, 'Drop bags at the flat', 'stay', undefined, ME],
  [0, '16:00', 90, 'Walk Alfama to the cathedral', 'sight', L.se],
  [0, '18:40', 45, 'Sunset at Senhora do Monte', 'sight', L.miradouro, MIA],
  [0, '21:00', 120, 'Fado at Clube de Fado', 'food', L.fado, MIA],
  [1, '10:00', 120, 'Castelo de São Jorge', 'sight', L.castelo],
  [1, '13:00', 90, 'Lunch at Time Out Market', 'food', L.timeout, MIA],
  [1, '15:00', 60, 'Browse Livraria Bertrand', 'shopping', L.bertrand],
  [1, '16:30', 30, 'Santa Justa Lift', 'sight', L.santajusta],
  [1, '19:30', 90, 'Dinner on Praça do Comércio', 'food', L.comercio, MIA],
  [2, '10:15', 105, 'Pena Palace', 'sight', L.pena, MIA],
  [2, '12:30', 60, 'Lunch at Tascantiga', 'food', L.tasca],
  [2, '14:00', 120, 'Quinta da Regaleira', 'sight', L.regaleira],
  [2, '16:30', 30, 'Travesseiros at Piriquita', 'food', L.piriquita],
  [2, '18:10', null, 'Train back to Lisbon', 'transport', L.sintraStation],
  [3, '10:00', 120, 'Jerónimos Monastery', 'sight', L.jeronimos],
  [3, '12:30', 30, 'Pastéis de Belém', 'food', L.pasteis, MIA],
  [3, '14:00', 60, 'Belém Tower', 'sight', L.torre],
  [3, '16:00', 90, 'MAAT and the river walk', 'activity', L.maat],
  [4, '11:00', 120, 'LX Factory', 'shopping', L.lx],
  [4, '14:00', 150, 'Gulbenkian Museum', 'sight', L.gulbenkian],
  [4, null, null, 'Pack for Porto', 'other', undefined, ME],
  [5, '12:30', 60, 'Lunch near São Bento', 'food', L.sao_bento],
  [5, '16:00', 90, 'Walk down to the Ribeira', 'activity', L.ribeira],
  [6, '10:00', 90, 'Livraria Lello', 'sight', L.lello, MIA],
  [6, '12:30', 60, 'Francesinha at Café Santiago', 'food', L.santiago, MIA],
  [6, '15:00', 45, 'Clérigos Tower', 'sight', L.clerigos],
  [6, '17:30', 60, 'Dom Luís I Bridge at dusk', 'activity', L.ponte],
  [7, '11:00', 150, 'Port tasting in Gaia', 'food', L.gaia, MIA],
  [7, '15:00', 120, 'Serralves Museum', 'sight', L.serralves],
  [7, '19:00', 90, 'Seafood in Foz', 'food', L.foz],
  [8, '09:00', 60, 'Last coffee by the river', 'food', L.ribeira],
  [8, '11:30', null, 'Airport transfer', 'transport', L.sao_bento],
  // Ideas
  [null, null, null, 'Ginjinha tasting', 'food', P('A Ginjinha', 38.7143, -9.1391, 'Lisbon')],
  [null, null, null, 'Day trip to Cascais', 'activity', P('Cascais', 38.6979, -9.4215, 'Cascais')],
  [null, null, null, 'Time Out Market for the tiles', 'shopping'],
  [null, null, null, 'Tram 28 early', 'activity'],
  [null, null, null, 'Sardines to bring home', 'shopping'],
  [null, null, null, 'Cabo da Roca', 'sight', P('Cabo da Roca', 38.7804, -9.4989, 'Colares')],
  [
    null,
    null,
    null,
    'Palácio de Monserrate',
    'sight',
    P('Monserrate Palace', 38.7969, -9.4194, 'Sintra'),
  ],
  [
    null,
    null,
    null,
    'Miradouro da Graça',
    'sight',
    P('Miradouro da Graça', 38.7189, -9.1301, 'Lisbon'),
  ],
  [null, null, null, 'Bairro Alto at night', 'activity'],
  [null, null, null, 'Pink Street drinks', 'food'],
  [
    null,
    null,
    null,
    'Lisbon Oceanarium',
    'activity',
    P('Oceanário de Lisboa', 38.7634, -9.0938, 'Lisbon'),
  ],
  [null, null, null, 'Casa da Música', 'sight', P('Casa da Música', 41.1596, -8.6307, 'Porto')],
  [
    null,
    null,
    null,
    'Matosinhos grilled fish',
    'food',
    P('Matosinhos', 41.1844, -8.6963, 'Matosinhos'),
  ],
  [null, null, null, 'Douro valley day', 'activity'],
]

export function buildSeedTrips(today: string, phase: Phase, now = Date.now()): Trip[] {
  const start =
    phase === 'during'
      ? addDays(today, -2)
      : phase === 'before'
        ? addDays(today, 10)
        : addDays(today, -20)
  const day = (n: number) => addDays(start, n)
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()

  const todos: TripTodo[] = ROWS.map((r, i) => {
    const [d, time, min, title, category, place, by] = r
    const recent = i % 7 === 3
    return {
      todo_id: `ttd_${hex(i + 1)}`,
      title,
      done: d !== null && d < 2 && phase === 'during',
      day: d === null ? null : day(d),
      start_time: time,
      duration_min: min,
      tz: place?.tz ?? TZ,
      order: i + 1,
      category,
      place: place ?? null,
      created_by: by ?? MIA,
      updated_by: recent ? MIA : (by ?? MIA),
      updated_at: recent ? iso(2 * 3600_000) : iso(5 * 86400_000),
    }
  })

  const b = (n: number, p: Partial<Booking>): Booking => ({
    booking_id: `tbk_${hex(n)}`,
    kind: 'other',
    title: '',
    created_by: MIA,
    updated_by: MIA,
    updated_at: iso(3 * 86400_000),
    ...p,
  })
  const bookings: Booking[] = [
    b(1, {
      kind: 'flight',
      title: 'London to Lisbon',
      confirmation_code: 'TP1355',
      starts_at: `${day(0)}T07:05`,
      start_tz: 'Europe/London',
      ends_at: `${day(0)}T09:40`,
      end_tz: TZ,
    }),
    b(2, {
      kind: 'stay',
      title: 'Alfama flat',
      confirmation_code: 'AIRB-8841',
      starts_at: `${day(0)}T15:00`,
      ends_at: `${day(5)}T11:00`,
      start_tz: TZ,
      end_tz: TZ,
      place: L.se,
    }),
    b(3, {
      kind: 'train',
      title: 'Rossio to Sintra',
      confirmation_code: 'CP-77120',
      starts_at: `${day(2)}T08:41`,
      start_tz: TZ,
    }),
    b(4, {
      kind: 'ticket',
      title: 'Pena Palace, timed entry',
      confirmation_code: 'PENA-5521',
      starts_at: `${day(2)}T10:00`,
      start_tz: TZ,
      place: L.pena,
    }),
    b(5, {
      kind: 'train',
      title: 'Alfa Pendular to Porto',
      confirmation_code: 'CP-90417',
      starts_at: `${day(5)}T09:15`,
      ends_at: `${day(5)}T11:50`,
      start_tz: TZ,
      end_tz: TZ,
    }),
    b(6, {
      kind: 'stay',
      title: 'Hotel in Ribeira',
      confirmation_code: 'BKG-33210',
      starts_at: `${day(5)}T14:00`,
      ends_at: `${day(8)}T10:00`,
      start_tz: TZ,
      end_tz: TZ,
      place: L.ribeira,
    }),
    b(7, {
      kind: 'flight',
      title: 'Porto to London',
      confirmation_code: 'FR2210',
      starts_at: `${day(8)}T14:20`,
      start_tz: TZ,
      ends_at: `${day(8)}T16:50`,
      end_tz: 'Europe/London',
    }),
  ]

  const lisbonPorto: Trip = {
    trip_id: `trip_${hex(1)}`,
    title: 'Lisbon & Porto',
    destination: L.se,
    notes: 'Synthetic example trip. Nothing here is a real booking.',
    start_date: day(0),
    end_date: day(8),
    tz: TZ,
    stops: [
      { ...L.se, name: 'Lisbon', locality: 'Lisbon' },
      { ...L.ribeira, name: 'Porto', locality: 'Porto' },
    ],
    days: { [day(0)]: 'Arrival', [day(5)]: 'Train north' },
    packing_list_id: null,
    todos,
    bookings,
    version: 1,
  }

  const ghent: Trip = {
    trip_id: `trip_${hex(2)}`,
    title: 'Weekend in Ghent',
    destination: P('Ghent', 51.0543, 3.7174, 'Ghent'),
    start_date: addDays(today, 40),
    end_date: addDays(today, 42),
    tz: 'Europe/Brussels',
    todos: [],
    bookings: [],
    version: 1,
  }
  const draft: Trip = {
    trip_id: `trip_${hex(3)}`,
    title: 'Somewhere warm in January',
    todos: [
      {
        todo_id: `ttd_${hex(900)}`,
        title: 'Madeira levadas',
        done: false,
        day: null,
        order: 1,
        category: 'activity',
        created_by: MIA,
      },
    ],
    bookings: [],
    version: 1,
  }
  const past: Trip = {
    trip_id: `trip_${hex(4)}`,
    title: 'Day trip to Bruges',
    destination: P('Bruges', 51.2093, 3.2247, 'Bruges'),
    start_date: addDays(today, -60),
    end_date: addDays(today, -60),
    tz: 'Europe/Brussels',
    todos: [],
    bookings: [],
    version: 1,
  }
  return [lisbonPorto, ghent, draft, past]
}
