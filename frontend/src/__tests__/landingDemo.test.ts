import {
  categorize,
  cleanEntry,
  demoReducer,
  initialDemo,
  initialSlip,
  MAX_DEMO_ADDS,
  slipReducer,
  slipStatus,
} from '@components/landing/demo'

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
