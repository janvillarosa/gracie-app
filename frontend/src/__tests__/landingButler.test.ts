import {
  BUTLER_ADDED,
  BUTLER_MOMENTS,
  BUTLER_ROUTE,
  butlerStep,
} from '@components/landing/butlerWeek'

describe('a week with Butler (landing)', () => {
  const [suggest, assist, upnext] = BUTLER_MOMENTS

  it('takes Thursday’s suggestion: oat milk lands on top, freshly marked', () => {
    const rows = butlerStep(suggest)
    expect(rows.map((r) => r.text)).toEqual(['Oat milk', 'Sourdough', 'Bananas', 'Coffee beans'])
    expect(rows[0].fresh).toBe(true)
  })

  it('has nothing to do on Friday night: what it added is already on the list, each with the bell', () => {
    expect(butlerStep(assist)).toBe(assist.rows)
    const belled = assist.rows.filter((r) => r.bell).map((r) => r.text)
    expect(belled).toEqual(BUTLER_ADDED)
  })

  it('ticks Saturday’s first pick and leaves the rest of the route', () => {
    const rows = butlerStep(upnext)
    const open = rows.filter((r) => !r.done).map((r) => r.text)
    expect(open).toEqual(BUTLER_ROUTE.slice(1))
  })
})
