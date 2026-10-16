import {
  categorize,
  cleanEntry,
  demoReducer,
  initialDemo,
  initialPlan,
  initialTrip,
  initialSlip,
  MAX_DEMO_ADDS,
  planMove,
  planPins,
  planReady,
  MATE_ADDS,
  mateStep,
  nextMateAdd,
  PLATE_START,
  PLATE_WORDS,
  plateLand,
  plateTick,
  slipReducer,
  slipStatus,
  tripReducer,
} from '@components/landing/demo'

describe('planning desk', () => {
  it('lands an idea on its day in time order, and takes it out of Ideas', () => {
    const s = planMove(initialPlan(), 'i3')
    expect(s.ideas.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(s.days.sat.map((d) => d.what)).toEqual([
      'São Bento station',
      'Francesinha',
      'Dinner in Ribeira',
    ])
    expect(s.days.sat[1].fresh).toBe(true)
    expect(s.days.sat[0].fresh).toBe(false)
  })

  it('puts the planned stops on the map, one colour per day', () => {
    const s = planMove(initialPlan(), 'i1')
    expect(planPins(s).map((p) => [p.name, p.day])).toEqual([
      ['São Bento station', 0],
      ['Dinner in Ribeira', 0],
      ['Livraria Lello', 1],
    ])
    expect(planPins(s)[2].fresh).toBe(true)
  })

  it('brings the next stop up when one is ticked, and closes an open code', () => {
    let t = tripReducer(initialTrip(), { type: 'code', id: 't1' })
    expect(t.shown).toBe('t1')
    t = tripReducer(t, { type: 'done', id: 't1' })
    expect(t.shown).toBeNull()
    expect(t.stops.find((x) => !x.done)?.title).toBe('São Bento station')
    expect(
      tripReducer(tripReducer(t, { type: 'code', id: 't2' }), { type: 'code', id: 't2' }).shown,
    ).toBeNull()
  })

  it('ignores an idea that is already on a day', () => {
    const once = planMove(initialPlan(), 'i2')
    expect(planMove(once, 'i2')).toBe(once)
    expect(planMove(once, 'nope')).toBe(once)
  })

  it('is ready to go once no day is empty', () => {
    expect(planReady(initialPlan()).filter((l) => !l.ok)).toEqual([
      { key: 'days', ok: false, text: 'Sun 26 has nothing planned yet' },
    ])
    expect(planReady(planMove(initialPlan(), 'i2')).every((l) => l.ok)).toBe(true)
  })
})

describe('housemate lines', () => {
  it('skips a line that is already on the list', () => {
    let s = demoReducer(initialDemo(), { type: 'mateAdd', id: 'm0', text: 'Yogurt' })
    const next = nextMateAdd(s, 0)
    expect(next?.add.text).toBe(MATE_ADDS[1].text)
    s = demoReducer(s, { type: 'mateAdd', id: 'm9', text: 'yogurt' })
    expect(s.items.filter((i) => i.text === 'Yogurt')).toHaveLength(1)
  })

  it('ticks the oldest line only once the list is long', () => {
    let s = initialDemo()
    expect(mateStep(s, 0, 4)).toMatchObject({ tick: null, next: { add: { text: 'Yogurt' } } })
    s = demoReducer(s, { type: 'mateAdd', id: 'm0', text: 'Yogurt' })
    expect(mateStep(s, 1, 4)).toMatchObject({ tick: 'p3', next: { add: { text: 'Passports' } } })
  })

  it('does not use up the visitor’s adds, and stamps trip lines as trips', () => {
    let s = demoReducer(initialDemo(), {
      type: 'mateAdd',
      id: 'm1',
      text: 'Passports',
      stamp: { key: 'trips', label: 'Trips' },
    })
    expect(s.adds).toBe(0)
    s = demoReducer(s, { type: 'stamp', id: 'm1' })
    expect(s.items[0]).toMatchObject({ text: 'Passports', stamp: { label: 'Trips' }, fresh: true })
  })
})

describe('typing list', () => {
  it('keeps the list the same length: a tick, then a new line on top', () => {
    let rows = plateTick(PLATE_START)
    expect(rows[rows.length - 1].done).toBe(true)
    rows = plateLand(rows, 'Oat milk', 't1')
    expect(rows.map((r) => r.text)).toEqual(['Oat milk', 'Basmati rice', 'Lemons', 'Sourdough'])
    expect(rows[0]).toMatchObject({ id: 't1', fresh: true, stamp: null })
  })

  // Regression: scrolling away just after a line landed restarted the loop on the same word,
  // so "Oat milk" showed twice in the groceries card.
  it('never lands a line that is already on the list', () => {
    let rows = plateLand(plateTick(PLATE_START), 'Oat milk', 't1')
    rows = plateLand(plateTick(rows), 'oat milk', 't2')
    expect(rows.filter((r) => r.text.toLowerCase() === 'oat milk')).toHaveLength(1)
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it('ticks one line per new line, so a restarted loop keeps the list full', () => {
    const twice = plateTick(plateTick(PLATE_START))
    expect(twice.filter((r) => r.done)).toHaveLength(1)
    const rows = plateLand(twice, 'Oat milk', 't1')
    const again = plateLand(plateTick(plateTick(rows)), 'Oat milk', 't2')
    expect(again.filter((r) => !r.done)).toHaveLength(PLATE_START.length - 1)
    expect(again).toHaveLength(PLATE_START.length)
  })

  it('types words that are not on the starting list', () => {
    const start = new Set(PLATE_START.map((r) => r.text.toLowerCase()))
    for (const w of PLATE_WORDS) expect(start.has(w.toLowerCase())).toBe(false)
  })
})

describe('landing list', () => {
  it('stamps common items the way the app would', () => {
    expect(categorize('Oat milk').label).toBe('Dairy')
    expect(categorize('Lemons x4').label).toBe('Produce')
    expect(categorize('sourdough').label).toBe('Bakery')
    expect(categorize('bin bags').label).toBe('Household')
    expect(categorize('a birthday card').label).toBe('General')
  })

  it('cleans what the visitor typed', () => {
    expect(cleanEntry('   ')).toBeNull()
    expect(cleanEntry('  oat   milk ')).toBe('Oat milk')
    expect(cleanEntry('x'.repeat(200))?.length).toBeLessThanOrEqual(60)
  })

  it('adds new lines on top, unstamped until the stamp lands', () => {
    let s = demoReducer(initialDemo(), { type: 'add', text: 'oat milk' })
    expect(s.items[0]).toMatchObject({ id: 'v1', text: 'Oat milk', stamp: null, fresh: true })
    s = demoReducer(s, { type: 'stamp', id: 'v1' })
    expect(s.items[0].stamp?.label).toBe('Dairy')
  })

  it('stops after the demo cap', () => {
    let s = initialDemo()
    for (let i = 0; i < MAX_DEMO_ADDS + 3; i++)
      s = demoReducer(s, { type: 'add', text: `item ${i}` })
    expect(s.adds).toBe(MAX_DEMO_ADDS)
  })

  it('a housemate tick never unticks a line the visitor already ticked', () => {
    let s = demoReducer(initialDemo(), { type: 'add', text: 'eggs' })
    s = demoReducer(s, { type: 'toggle', id: 'v1' })
    s = demoReducer(s, { type: 'tick', id: 'v1' })
    expect(s.items[0]).toMatchObject({ done: true })
  })

  it('folds a ticked line away, and unticking brings it back', () => {
    let s = demoReducer(initialDemo(), { type: 'add', text: 'eggs' })
    s = demoReducer(s, { type: 'archive', id: 'v1' })
    expect(s.items[0].archived).toBeFalsy() // only ticked lines fold away
    s = demoReducer(s, { type: 'tick', id: 'v1' })
    s = demoReducer(s, { type: 'archive', id: 'v1' })
    expect(s.items[0]).toMatchObject({ done: true, archived: true })
    s = demoReducer(s, { type: 'toggle', id: 'v1' })
    expect(s.items[0]).toMatchObject({ done: false, archived: false })
  })
})

describe('landing offline slip', () => {
  it('queues changes made with no signal and syncs them on return', () => {
    let s = slipReducer(initialSlip(), { type: 'signal', online: false })
    s = slipReducer(s, { type: 'toggle', id: 's2' })
    s = slipReducer(s, { type: 'toggle', id: 's3' })
    expect(slipStatus(s)).toBe('No signal. 2 changes saved on this phone')
    // Undoing a waiting change takes it out of the queue.
    s = slipReducer(s, { type: 'toggle', id: 's3' })
    expect(s.pending).toEqual(['s2'])
    s = slipReducer(s, { type: 'signal', online: true })
    expect(slipStatus(s)).toBe('Back online. 1 change synced')
    expect(s.pending).toEqual([])
  })

  it('online edits sync at once', () => {
    const s = slipReducer(initialSlip(), { type: 'toggle', id: 's2' })
    expect(s.pending).toEqual([])
    expect(slipStatus(s)).toBe('Everyone’s up to date')
  })
})
