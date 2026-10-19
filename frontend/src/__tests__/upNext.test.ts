import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pickUpNext } from '@lib/upNext'
import type { RouteItem } from '@api/types'

// The same cases the Go pick rule runs (autopilot.PickUpNext), so the two cannot drift.
const cases = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../backend/internal/autopilot/testdata/upnext_cases.json'),
    'utf8',
  ),
) as { name: string; route: RouteItem[]; anchor: string; next: string; then: string }[]

describe('pickUpNext', () => {
  it('has the shared cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(7)
  })

  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { next, after } = pickUpNext(c.route, c.anchor || undefined)
    expect(next?.item_id ?? '').toBe(c.next)
    expect(after?.item_id ?? '').toBe(c.then)
  })
})
