// Butler's three moments in one House's week, as the Butler part of the landing page shows them on
// one Groceries list. Pure data and one step function, so the page and its tests share them. The
// House and its shopping are an example; the slips and stamps are the app's own.

export type ButlerKey = 'suggest' | 'assist' | 'upnext'

export type ButlerRow = {
  id: string
  text: string
  stamp: { key: string; label: string }
  /** Butler put it on the list (the row carries the bell). */
  bell?: boolean
  done?: boolean
  fresh?: boolean
}

export type ButlerMoment = {
  key: ButlerKey
  when: string
  title: string
  text: string
  /** The list header's second line. */
  meta: string
  /** What the drawn sheet shows, for screen readers (the sheet itself is decoration). */
  scene: string
  rows: ButlerRow[]
}

const OAT = { id: 'oat', text: 'Oat milk', stamp: { key: 'dairy', label: 'Dairy' } }
const EGGS = { id: 'eggs', text: 'Eggs', stamp: { key: 'dairy', label: 'Dairy' } }
const BUTTER = { id: 'butter', text: 'Butter', stamp: { key: 'dairy', label: 'Dairy' } }
const BREAD = { id: 'bread', text: 'Sourdough', stamp: { key: 'bakery', label: 'Bakery' } }
const BANANAS = { id: 'bananas', text: 'Bananas', stamp: { key: 'produce', label: 'Produce' } }
const COFFEE = { id: 'coffee', text: 'Coffee beans', stamp: { key: 'pantry', label: 'Pantry' } }

export const BUTLER_MOMENTS: ButlerMoment[] = [
  {
    key: 'suggest',
    when: 'Thursday',
    title: 'Before you run out',
    text: 'When the oat milk is about to run out, it suggests it. Tap Add and it’s on the list.',
    meta: '3 to get',
    scene:
      'Thursday, on the Groceries list: Butler suggests oat milk, which your House adds weekly.',
    rows: [BREAD, BANANAS, COFFEE],
  },
  {
    key: 'assist',
    when: 'Friday night',
    title: 'Before the shop',
    text: 'Switch it to Assist and it stops asking. The night before you shop, it puts the usual things on the list itself and says why for each one.',
    meta: '6 to get · shop tomorrow',
    scene:
      'Friday night: Butler has put eggs, butter and oat milk on the list for Saturday’s shop, each marked with its bell.',
    rows: [
      { ...EGGS, bell: true },
      { ...BUTTER, bell: true },
      { ...OAT, bell: true },
      BREAD,
      BANANAS,
    ],
  },
  {
    key: 'upnext',
    when: 'Saturday',
    title: 'In the shop',
    text: 'While you shop, Up next shows what you usually grab next. It learned that from the order your House ticks things off.',
    meta: 'Shopping now · 2 of 6',
    scene: 'Saturday, in the shop: Up next shows eggs, and butter after that.',
    rows: [
      { ...BANANAS, done: true },
      { ...BREAD, done: true },
      { ...EGGS, bell: true },
      { ...BUTTER, bell: true },
      { ...OAT, bell: true },
      COFFEE,
    ],
  },
]

/** The suggestion Thursday's slip offers. */
export const BUTLER_SUGGESTION = { ...OAT, cadence: 'You add it weekly' }

/** What Friday night's slip says Butler added, in list order. */
export const BUTLER_ADDED = ['Eggs', 'Butter', 'Oat milk']

/** The usual route through the shop on Saturday, from the first unticked item. */
export const BUTLER_ROUTE = ['Eggs', 'Butter', 'Oat milk', 'Coffee beans']

/** Each moment plays out once while it is on screen: Thursday's suggestion is taken and lands on
 *  top of the list; Saturday's first pick is ticked and Up next moves on to the one after. Friday
 *  night has nothing to do (that is the point). Returns the rows after the step. */
export function butlerStep(moment: ButlerMoment): ButlerRow[] {
  if (moment.key === 'suggest') {
    return [{ ...OAT, fresh: true }, ...moment.rows]
  }
  if (moment.key === 'upnext') {
    return moment.rows.map((r) => (r.text === BUTLER_ROUTE[0] ? { ...r, done: true } : r))
  }
  return moment.rows
}
