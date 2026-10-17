import { addedLine, latestRun, reasonText, runDay } from '@lib/autopilot'
import type { AutopilotApplied } from '@api/types'

describe('autopilot words', () => {
  it('says why in the House’s words', () => {
    expect(reasonText({ code: 'every_days', params: { days: 9 } })).toBe(
      'You buy it about every 9 days',
    )
    expect(reasonText({ code: 'every_days', params: { days: 7 } })).toBe(
      'You buy it about every week',
    )
    expect(reasonText({ code: 'every_days', params: { days: 14 } })).toBe(
      'You buy it about every 2 weeks',
    )
    expect(reasonText({ code: 'every_days', params: { days: 1 } })).toBe(
      'You buy it about every day',
    )
    expect(reasonText(undefined)).toBe('Added because you usually buy it around now')
  })

  it('names the run by day', () => {
    const now = new Date(2026, 9, 16, 9) // Friday
    expect(runDay(new Date(2026, 9, 16, 18), now)).toBe('today')
    expect(runDay(new Date(2026, 9, 17, 10), now)).toBe('tomorrow')
    expect(runDay(new Date(2026, 9, 18, 10), now)).toBe('Sunday')
    expect(addedLine(4, new Date(2026, 9, 18, 10), now)).toBe('Added 4 for Sunday')
  })

  it('keeps only what still waits for the latest run', () => {
    const a = (
      id: string,
      run: string,
      state: 'applied' | 'confirmed' = 'applied',
    ): AutopilotApplied => ({
      action_id: id,
      item_id: `i-${id}`,
      key: id,
      state,
      run_at: run,
      reason: { code: 'every_days' },
      confidence: 0.9,
    })
    expect(latestRun([])).toBeNull()
    const r = latestRun([
      a('old', '2026-10-10T09:00:00Z'),
      a('m', '2026-10-17T09:00:00Z'),
      a('e', '2026-10-17T09:00:00Z'),
      a('b', '2026-10-17T09:00:00Z', 'confirmed'),
    ])
    expect(r?.runAt).toBe('2026-10-17T09:00:00Z')
    expect(r?.actions.map((x) => x.action_id)).toEqual(['m', 'e'])
  })
})
