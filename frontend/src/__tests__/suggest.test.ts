import { ghostRemainder, rankSuggestions } from '@lib/suggest'
import type { PantryItem } from '@api/types'

const p = (description: string, extra: Partial<PantryItem> = {}): PantryItem => ({
  description,
  category: 'Pantry',
  quantity: '',
  unit: '',
  times_added: 1,
  last_added_at: '2026-01-01T00:00:00Z',
  common: false,
  ...extra,
})

const pantry = [
  p('Basmati rice', { quantity: '1', unit: 'kg' }),
  p('Oat milk'),
  p('Bananas'),
  p('Brown basmati'),
  p('Rhubarb'),
]

describe('rankSuggestions', () => {
  it('ranks prefix matches before word and substring matches, keeping pantry order', () => {
    const out = rankSuggestions('bas', pantry, 5).map((s) => s.item.description)
    expect(out).toEqual(['Basmati rice', 'Brown basmati'])
  })

  it('matches on the description once a leading quantity is parsed off', () => {
    const out = rankSuggestions('2 kg bas', pantry, 5)
    expect(out[0].item.description).toBe('Basmati rice')
    expect(out[0]).toMatchObject({ start: 0, length: 3 })
  })

  it('only matches inside a word from three characters', () => {
    expect(rankSuggestions('ar', pantry, 5)).toEqual([])
    expect(rankSuggestions('arb', pantry, 5).map((s) => s.item.description)).toEqual(['Rhubarb'])
  })

  it('skips an exact match and respects the limit', () => {
    expect(rankSuggestions('oat milk', pantry, 5)).toEqual([])
    expect(rankSuggestions('b', pantry, 2)).toHaveLength(2)
  })

  it('returns nothing for empty or quantity-only input', () => {
    expect(rankSuggestions('', pantry, 5)).toEqual([])
    expect(rankSuggestions('2', pantry, 5)).toEqual([])
  })
})

describe('ghostRemainder', () => {
  it('completes the typed prefix with the suggestion tail', () => {
    const [top] = rankSuggestions('bas', pantry, 1)
    expect(ghostRemainder('bas', top)).toBe('mati rice')
    expect(ghostRemainder('2 kg bas', top)).toBe('mati rice')
  })

  it('is empty when the match is not a prefix', () => {
    const [top] = rankSuggestions('arb', pantry, 1)
    expect(ghostRemainder('arb', top)).toBe('')
  })
})
