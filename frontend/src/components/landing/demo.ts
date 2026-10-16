// Pure logic for the landing page's live list and itinerary slip. Everything here is local: the
// page never calls the API. Mia, Sam and Jo are the example House's members.

export type StampKey =
  | 'simple'
  | 'shared'
  | 'trips'
  | 'free'
  | 'produce'
  | 'dairy'
  | 'bakery'
  | 'meat'
  | 'frozen'
  | 'pantry'
  | 'grains'
  | 'drinks'
  | 'household'
  | 'general'

export type Stamp = { key: StampKey; label: string }

export type DemoItem = {
  id: string
  text: string
  done: boolean
  // Ticked a moment ago and folded away under "Show checked-off items", as the List page does.
  archived?: boolean
  stamp: Stamp | null
  // The stamp a housemate's line gets when the categoriser wouldn't guess it (a trip line).
  stampAs?: Stamp
  // True for new lines: they get the highlighter swipe as they land.
  fresh?: boolean
}

export const MAX_DEMO_ADDS = 8
export const MAX_DEMO_TEXT = 60

// The first screen's list: a real week's list for an example House, short enough to read at a
// glance, with one line for the trip.
export const START_ITEMS: DemoItem[] = [
  { id: 'p1', text: 'Lemons', done: false, stamp: { key: 'produce', label: 'Produce' } },
  { id: 'p2', text: 'Bin bags', done: false, stamp: { key: 'household', label: 'Household' } },
  { id: 'p3', text: 'Porto train tickets', done: false, stamp: { key: 'trips', label: 'Trips' } },
]

// While the visitor watches, the housemates keep adding to it, one line at a time.
export type MateAdd = { who: 'Mia' | 'Sam' | 'Jo'; text: string; stamp?: Stamp }
export const MATE_ADDS: MateAdd[] = [
  { who: 'Mia', text: 'Yogurt' },
  { who: 'Sam', text: 'Passports', stamp: { key: 'trips', label: 'Trips' } },
  { who: 'Jo', text: 'Dish soap' },
  { who: 'Mia', text: 'Tomatoes' },
  { who: 'Sam', text: 'Sunscreen', stamp: { key: 'trips', label: 'Trips' } },
  { who: 'Jo', text: 'Coffee' },
]

/** One housemate step: which line to tick first (the oldest, once the list has `maxOpen` lines)
 *  and which line to add next, from `turn` on. */
export function mateStep(
  state: DemoState,
  turn: number,
  maxOpen: number,
): { tick: string | null; next: { add: MateAdd; turn: number } | null } {
  const open = state.items.filter((i) => !i.done)
  const tick = open.length >= maxOpen ? open[open.length - 1].id : null
  return { tick, next: nextMateAdd(state, turn) }
}

/** The next housemate line from `turn` on that isn't already on the list. */
export function nextMateAdd(state: DemoState, turn: number): { add: MateAdd; turn: number } | null {
  const open = new Set(state.items.filter((i) => !i.done).map((i) => i.text.toLowerCase()))
  for (let k = 0; k < MATE_ADDS.length; k++) {
    const t = turn + k
    const add = MATE_ADDS[t % MATE_ADDS.length]
    if (!open.has(add.text.toLowerCase())) return { add, turn: t }
  }
  return null
}

// A small stand-in for the server's categoriser: enough words that the stamp a visitor sees is
// usually the one the real app would give.
const WORDS: Array<[Exclude<StampKey, 'simple' | 'shared' | 'trips' | 'free'>, string, string[]]> =
  [
    [
      'dairy',
      'Dairy',
      [
        'milk',
        'cheese',
        'cheddar',
        'mozzarella',
        'parmesan',
        'yogurt',
        'yoghurt',
        'butter',
        'cream',
        'egg',
        'feta',
      ],
    ],
    [
      'produce',
      'Produce',
      [
        'apple',
        'banana',
        'lemon',
        'lime',
        'tomato',
        'onion',
        'garlic',
        'avocado',
        'spinach',
        'lettuce',
        'potato',
        'carrot',
        'pepper',
        'berr',
        'grape',
        'orange',
        'herb',
        'basil',
        'cucumber',
        'mushroom',
        'fruit',
        'veg',
      ],
    ],
    [
      'bakery',
      'Bakery',
      ['bread', 'sourdough', 'bagel', 'croissant', 'bun', 'roll', 'cake', 'pastr', 'tortilla'],
    ],
    [
      'meat',
      'Meat',
      [
        'chicken',
        'beef',
        'pork',
        'bacon',
        'sausage',
        'mince',
        'ham',
        'salmon',
        'fish',
        'tuna',
        'prawn',
        'shrimp',
      ],
    ],
    ['frozen', 'Frozen', ['frozen', 'ice cream', 'peas', 'ice']],
    ['drinks', 'Drinks', ['coffee', 'tea', 'juice', 'wine', 'beer', 'water', 'soda', 'kombucha']],
    [
      'household',
      'Household',
      [
        'bin bag',
        'soap',
        'detergent',
        'toilet',
        'paper towel',
        'sponge',
        'bulb',
        'battery',
        'batteries',
        'bleach',
        'tissue',
        'shampoo',
        'toothpaste',
        'sunscreen',
        'candle',
        'plant',
      ],
    ],
    [
      'pantry',
      'Pantry',
      [
        'oat',
        'rice',
        'pasta',
        'flour',
        'sugar',
        'salt',
        'oil',
        'beans',
        'lentil',
        'cereal',
        'honey',
        'jam',
        'sauce',
        'spice',
        'nut',
        'stock',
        'tin',
      ],
    ],
  ]

export function categorize(text: string): Stamp {
  const t = text.toLowerCase()
  for (const [key, label, words] of WORDS) {
    if (words.some((w) => t.includes(w))) return { key, label }
  }
  return { key: 'general', label: 'General' }
}

/** Trims and caps what the visitor typed; null when there is nothing to add. */
export function cleanEntry(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (!t) return null
  const capped = t.length > MAX_DEMO_TEXT ? `${t.slice(0, MAX_DEMO_TEXT - 1).trimEnd()}…` : t
  return capped.charAt(0).toUpperCase() + capped.slice(1)
}

export type DemoState = { items: DemoItem[]; adds: number; seq: number }

export type DemoAction =
  | { type: 'add'; text: string }
  // A housemate adds a line; it doesn't count toward the visitor's own adds.
  | { type: 'mateAdd'; id: string; text: string; stamp?: Stamp }
  | { type: 'stamp'; id: string }
  | { type: 'toggle'; id: string }
  // A housemate ticks a line; a line someone already ticked stays ticked.
  | { type: 'tick'; id: string }
  | { type: 'archive'; id: string }
  | { type: 'settle'; id: string }

export const initialDemo = (): DemoState => ({
  items: START_ITEMS.map((i) => ({ ...i })),
  adds: 0,
  seq: 0,
})

const patch = (state: DemoState, id: string, fn: (i: DemoItem) => DemoItem): DemoState => ({
  ...state,
  items: state.items.map((i) => (i.id === id ? fn(i) : i)),
})

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'add': {
      const text = cleanEntry(action.text)
      if (!text || state.adds >= MAX_DEMO_ADDS) return state
      const id = `v${state.seq + 1}`
      const item: DemoItem = { id, text, done: false, stamp: null, fresh: true }
      // New lines go on top, where the visitor is looking; nothing else moves.
      return { items: [item, ...state.items], adds: state.adds + 1, seq: state.seq + 1 }
    }
    case 'mateAdd': {
      if (state.items.some((i) => !i.done && i.text.toLowerCase() === action.text.toLowerCase()))
        return state
      const item: DemoItem = {
        id: action.id,
        text: action.text,
        done: false,
        stamp: null,
        stampAs: action.stamp,
        fresh: true,
      }
      return { ...state, items: [item, ...state.items] }
    }
    case 'stamp':
      return patch(state, action.id, (i) =>
        i.stamp ? i : { ...i, stamp: i.stampAs ?? categorize(i.text) },
      )
    case 'toggle':
      // Unticking a checked-off line brings it back to the list.
      return patch(state, action.id, (i) => ({
        ...i,
        done: !i.done,
        archived: false,
        fresh: false,
      }))
    case 'tick':
      return patch(state, action.id, (i) => (i.done ? i : { ...i, done: true, fresh: false }))
    case 'archive':
      return patch(state, action.id, (i) => (i.done ? { ...i, archived: true } : i))
    case 'settle':
      return patch(state, action.id, (i) => ({ ...i, fresh: false }))
  }
}

// ---- the typing list (lists section) ------------------------------------------------------

export type PlateRow = {
  id: string
  text: string
  qty?: string
  stamp: Stamp | null
  fresh?: boolean
  done?: boolean
}

export const PLATE_START: PlateRow[] = [
  { id: 's1', text: 'Basmati rice', qty: '2 kg', stamp: { key: 'grains', label: 'Grains' } },
  { id: 's2', text: 'Lemons', qty: '4', stamp: { key: 'produce', label: 'Produce' } },
  { id: 's3', text: 'Sourdough', stamp: { key: 'bakery', label: 'Bakery' } },
  { id: 's4', text: 'Frozen peas', stamp: { key: 'frozen', label: 'Frozen' } },
]

// What gets typed, in turn. Each one is sorted into its section the way the app does it.
export const PLATE_WORDS = ['Oat milk', 'Bin bags', 'Eggs', 'Coffee', 'Cheddar', 'Sponges']

/** Another housemate ticks the bottom open line. One tick waits for each new line, so a loop that
 *  restarts mid-word can't tick a second one and shrink the list. */
export function plateTick(rows: PlateRow[]): PlateRow[] {
  if (rows.some((r) => r.done)) return rows
  const last = [...rows].reverse().find((r) => !r.done)
  return last ? rows.map((r) => (r.id === last.id ? { ...r, done: true } : r)) : rows
}

/** The typed line lands on top and ticked lines fold away. A line that is already on the list is
 *  never added twice (the list stays as it is), so a restarted loop can't show it two times. */
export function plateLand(rows: PlateRow[], text: string, id: string): PlateRow[] {
  if (rows.some((r) => !r.done && r.text.toLowerCase() === text.toLowerCase())) return rows
  return [{ id, text, stamp: null, fresh: true }, ...rows.filter((r) => !r.done)]
}

// ---- the planning desk (trips section) ----------------------------------------------------

export type PlanDay = 'sat' | 'sun'
export type PlanPip = 'food' | 'sight' | 'transport'
// A place on the drawn map of Porto (see PortoMap), and which side of the point its pill sits.
export type PlanAt = { x: number; y: number; align: 'l' | 'r' | 'c' }
export type PlanIdea = {
  id: string
  what: string
  place?: string
  pip: PlanPip
  // Where the idea lands when someone picks a day for it.
  day: PlanDay
  time: string
  at?: PlanAt
}
export type PlanStop = {
  id: string
  what: string
  place?: string
  pip: PlanPip
  time: string
  at?: PlanAt
  fresh?: boolean
}
export type PlanState = { ideas: PlanIdea[]; days: Record<PlanDay, PlanStop[]> }
export type ReadyLine = { key: string; ok: boolean; text: string; meta?: string }

export const PLAN_DAYS: Array<{ key: PlanDay; label: string; where: string }> = [
  { key: 'sat', label: 'Sat 25', where: 'Porto' },
  { key: 'sun', label: 'Sun 26', where: 'Porto' },
]

export const initialPlan = (): PlanState => ({
  ideas: [
    {
      id: 'i1',
      what: 'Livraria Lello',
      place: 'Rua das Carmelitas',
      pip: 'sight',
      day: 'sun',
      time: '10:30',
      at: { x: 212, y: 262, align: 'l' },
    },
    {
      id: 'i2',
      what: 'Port cellars in Gaia',
      place: 'Vila Nova de Gaia',
      pip: 'food',
      day: 'sun',
      time: '15:30',
      at: { x: 310, y: 438, align: 'l' },
    },
    {
      id: 'i3',
      what: 'Francesinha',
      place: 'Rua de Passos Manuel',
      pip: 'food',
      day: 'sat',
      time: '13:00',
      at: { x: 352, y: 272, align: 'r' },
    },
  ],
  days: {
    sat: [
      {
        id: 'd1',
        what: 'São Bento station',
        place: 'Praça de Almeida Garrett',
        pip: 'sight',
        time: '11:00',
        at: { x: 288, y: 300, align: 'l' },
      },
      {
        id: 'd2',
        what: 'Dinner in Ribeira',
        place: 'Cais da Ribeira',
        pip: 'food',
        time: '20:00',
        at: { x: 284, y: 376, align: 'l' },
      },
    ],
    sun: [],
  },
})

/** Someone picks a day for an idea: it leaves Ideas and lands in its day, in time order. An idea
 *  that is no longer in Ideas is ignored, so a second tap or a replayed step changes nothing. */
export function planMove(state: PlanState, id: string): PlanState {
  const idea = state.ideas.find((i) => i.id === id)
  if (!idea) return state
  const stop: PlanStop = {
    id: `d-${idea.id}`,
    what: idea.what,
    place: idea.place,
    pip: idea.pip,
    time: idea.time,
    at: idea.at,
    fresh: true,
  }
  const day = [...state.days[idea.day].map((s) => ({ ...s, fresh: false })), stop].sort((a, b) =>
    a.time.localeCompare(b.time),
  )
  return {
    ideas: state.ideas.filter((i) => i.id !== id),
    days: { ...state.days, [idea.day]: day },
  }
}

/** "Ready to go?": what the trip still lacks, as the app's check list reads it. The train and the
 *  stay are booked already; a day with nothing on it is what is left. */
export function planReady(state: PlanState): ReadyLine[] {
  const empty = PLAN_DAYS.filter((d) => state.days[d.key].length === 0)
  return [
    { key: 'travel', ok: true, text: 'Travel booked', meta: '2' },
    { key: 'stay', ok: true, text: 'Stay for every night' },
    empty.length === 0
      ? { key: 'days', ok: true, text: 'Every day has a plan' }
      : { key: 'days', ok: false, text: `${empty[0].label} has nothing planned yet` },
  ]
}

/** The days' stops with a place on the map, as the map draws them: Saturday in the first day
 *  colour, Sunday in the second. */
export function planPins(state: PlanState) {
  const pins: Array<{
    id: string
    name: string
    time: string
    x: number
    y: number
    align: 'l' | 'r' | 'c'
    day: number
    fresh?: boolean
  }> = []
  for (const [day, key] of (['sat', 'sun'] as const).entries()) {
    for (const s of state.days[key]) {
      if (!s.at) continue
      pins.push({
        id: s.id,
        name: s.what,
        time: s.time,
        x: s.at.x,
        y: s.at.y,
        align: s.at.align,
        day,
        fresh: s.fresh,
      })
    }
  }
  return pins
}

// ---- the phone on the trip (trips section) -------------------------------------------------

export type TripStop = {
  id: string
  // The stop's own title, and the heading of the next-stop card: where to go.
  title: string
  heading: string
  sub: string
  time: string
  pip: PlanPip
  // A booking's code, behind "Show code".
  code?: string
  done: boolean
}
export type TripState = { stops: TripStop[]; shown: string | null }
export type TripAction = { type: 'done'; id: string } | { type: 'code'; id: string }

export const initialTrip = (): TripState => ({
  shown: null,
  stops: [
    {
      id: 't1',
      title: 'Train to Porto',
      heading: 'Santa Apolónia',
      sub: 'Train to Porto · Planned for 09:09 · Booked',
      time: '09:09',
      pip: 'transport',
      code: '7HQ2KD',
      done: false,
    },
    {
      id: 't2',
      title: 'São Bento station',
      heading: 'São Bento station',
      sub: 'Planned for 11:00',
      time: '11:00',
      pip: 'sight',
      done: false,
    },
    {
      id: 't3',
      title: 'Francesinha',
      heading: 'Rua de Passos Manuel',
      sub: 'Lunch · Planned for 13:00',
      time: '13:00',
      pip: 'food',
      done: false,
    },
    {
      id: 't4',
      title: 'Dinner in Ribeira',
      heading: 'Cais da Ribeira',
      sub: 'Dinner in Ribeira · Planned for 20:00',
      time: '20:00',
      pip: 'food',
      done: false,
    },
  ],
})

/** Ticking the next stop off brings the next one up, and closes any code that was open. A stop that
 *  is already done is left as it is. */
export function tripReducer(state: TripState, action: TripAction): TripState {
  switch (action.type) {
    case 'done':
      return {
        shown: null,
        stops: state.stops.map((s) => (s.id === action.id ? { ...s, done: true } : s)),
      }
    case 'code':
      return { ...state, shown: state.shown === action.id ? null : action.id }
  }
}

// ---- the offline slip ---------------------------------------------------------------------

export type SlipRow = { id: string; what: string; when: string; done: boolean }

export type SlipState = { online: boolean; rows: SlipRow[]; pending: string[]; synced: number }

export const SLIP_ROWS: Array<{ heading: string; rows: SlipRow[] }> = [
  {
    heading: 'Morning',
    rows: [
      { id: 's1', what: 'Train to Porto', when: '09:09', done: true },
      { id: 's2', what: 'São Bento station', when: '11:00', done: false },
    ],
  },
  {
    heading: 'Afternoon',
    rows: [
      { id: 's3', what: 'Francesinha for lunch', when: '13:00', done: false },
      { id: 's4', what: 'Check in at the flat', when: '16:30', done: false },
    ],
  },
  {
    heading: 'Evening',
    rows: [{ id: 's5', what: 'Dinner in Ribeira, booked', when: '20:00', done: false }],
  },
]

export type SlipAction = { type: 'toggle'; id: string } | { type: 'signal'; online: boolean }

export const initialSlip = (): SlipState => ({
  online: true,
  rows: SLIP_ROWS.flatMap((g) => g.rows.map((r) => ({ ...r }))),
  pending: [],
  synced: 0,
})

/** Mirrors the trip outbox: offline edits land at once and wait; going online flushes them. */
export function slipReducer(state: SlipState, action: SlipAction): SlipState {
  switch (action.type) {
    case 'toggle': {
      const rows = state.rows.map((r) => (r.id === action.id ? { ...r, done: !r.done } : r))
      if (state.online) return { ...state, rows, synced: 0 }
      const pending = state.pending.includes(action.id)
        ? state.pending.filter((p) => p !== action.id)
        : [...state.pending, action.id]
      return { ...state, rows, pending }
    }
    case 'signal': {
      if (action.online === state.online) return state
      if (action.online)
        return { ...state, online: true, synced: state.pending.length, pending: [] }
      return { ...state, online: false, synced: 0 }
    }
  }
}

export function slipStatus(s: SlipState): string {
  if (!s.online) {
    const n = s.pending.length
    if (n === 0) return 'No signal. Your changes save to this phone'
    return `No signal. ${n} ${n === 1 ? 'change' : 'changes'} saved on this phone`
  }
  if (s.synced > 0)
    return `Back online. ${s.synced} ${s.synced === 1 ? 'change' : 'changes'} synced`
  return 'Everyone’s up to date'
}
