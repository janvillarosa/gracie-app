import { hasFeature } from '@lib/autopilotFeatures'

const room = (extra: Record<string, unknown>) => ({ members: [], ...extra }) as never

describe('hasFeature', () => {
  it('reads the features the server sent', () => {
    const r = room({ autopilot_mode: 'suggest', autopilot_features: ['up_next'] })
    expect(hasFeature(r, 'up_next')).toBe(true)
    expect(hasFeature(r, 'suggestions')).toBe(false)
  })

  it('trusts an empty list from the server', () => {
    expect(hasFeature(room({ autopilot_mode: 'suggest', autopilot_features: [] }), 'up_next')).toBe(
      false,
    )
  })

  it.each([
    ['suggest', ['run_hint', 'suggestions', 'up_next']],
    ['assist', ['auto_add', 'run_hint', 'up_next']],
    ['off', []],
  ] as const)('falls back to the %s tier for an older server', (mode, features) => {
    for (const f of ['suggestions', 'auto_add', 'run_hint', 'up_next'] as const) {
      expect(hasFeature(room({ autopilot_mode: mode }), f)).toBe(
        (features as readonly string[]).includes(f),
      )
    }
  })

  it('reads the legacy suggestions_off as off', () => {
    expect(hasFeature(room({ suggestions_off: true }), 'up_next')).toBe(false)
    expect(hasFeature(room({}), 'suggestions')).toBe(true)
  })
})
