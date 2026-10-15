// Pure logic for the landing page's live list and itinerary slip. Everything here is local: the
// page never calls the API. Mia, Sam and Jo are the example House's members.

export type StampKey =
  | 'simple'
  | 'shared'
  | 'offline'
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
  // True for the visitor's own lines: they get the highlighter swipe as they land.
  fresh?: boolean
  // A pitch line that keeps a dry highlight.
  marked?: boolean
}

export const MAX_DEMO_ADDS = 8
export const MAX_DEMO_TEXT = 60

export const PITCH_ITEMS: DemoItem[] = [
  {
    id: 'p1',
    text: 'Simple enough to use one-handed in the shop',
    done: false,
    stamp: { key: 'simple', label: 'Simple' },
  },
  {
    id: 'p2',
    text: 'It sorts your list into aisles for you',
    done: false,
    stamp: { key: 'drinks', label: 'Sorted' },
  },
  {
    id: 'p3',
    text: 'Everyone at home can add to it',
    done: false,
    stamp: { key: 'shared', label: 'Shared' },
  },
  {
    id: 'p4',
    text: 'Works without signal',
    done: false,
    marked: true,
    stamp: { key: 'offline', label: 'Offline' },
  },
]

// A small stand-in for the server's categoriser: enough words that the stamp a visitor sees is
// usually the one the real app would give.
const WORDS: Array<
  [Exclude<StampKey, 'simple' | 'shared' | 'offline' | 'free'>, string, string[]]
> = [
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
  | { type: 'stamp'; id: string }
  | { type: 'toggle'; id: string }
  // A housemate ticks a line; a line someone already ticked stays ticked.
  | { type: 'tick'; id: string }
  | { type: 'archive'; id: string }
  | { type: 'settle'; id: string }

export const initialDemo = (): DemoState => ({
  items: PITCH_ITEMS.map((i) => ({ ...i })),
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
    case 'stamp':
      return patch(state, action.id, (i) => (i.stamp ? i : { ...i, stamp: categorize(i.text) }))
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

// ---- the offline slip ---------------------------------------------------------------------

export type SlipRow = { id: string; what: string; when: string; done: boolean }

export type SlipState = { online: boolean; rows: SlipRow[]; pending: string[]; synced: number }

export const SLIP_ROWS: Array<{ heading: string; rows: SlipRow[] }> = [
  {
    heading: 'Morning',
    rows: [
      { id: 's1', what: 'Pastéis in Belém', when: '09:30', done: true },
      { id: 's2', what: 'Tram 28 to Graça', when: '11:00', done: false },
    ],
  },
  {
    heading: 'Afternoon',
    rows: [
      { id: 's3', what: 'Miradouro da Senhora do Monte', when: '14:00', done: false },
      { id: 's4', what: 'Pick up the Porto train tickets', when: '16:30', done: false },
    ],
  },
  {
    heading: 'Evening',
    rows: [{ id: 's5', what: 'Dinner in Alfama, booked', when: '20:00', done: false }],
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
