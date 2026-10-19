import type { PantryItem } from '@api/types'
import { ghostRemainder, rankSuggestions } from '@lib/suggest'

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

  it('folds spacing and plurals after the literal tiers', () => {
    const beans = [p('Butter beans'), p('Chickpeas'), p('Peanut butter')]
    expect(rankSuggestions('butterbean', beans, 5).map((s) => s.item.description)).toEqual([
      'Butter beans',
    ])
    const [chick] = rankSuggestions('chick pea', beans, 5)
    expect(chick).toMatchObject({ start: 0, length: 'Chickpeas'.length })
    expect(rankSuggestions('butter', beans, 5).map((s) => s.item.description)).toEqual([
      'Butter beans',
      'Peanut butter',
    ])
  })

  it('forgives a typo from five letters, last of all', () => {
    expect(rankSuggestions('bananna', pantry, 5).map((s) => s.item.description)).toEqual([
      'Bananas',
    ])
    expect(rankSuggestions('brocoli', [p('Broccoli')], 5)).toHaveLength(1)
    expect(rankSuggestions('rhubrab', pantry, 5).map((s) => s.item.description)).toEqual([])
  })

  it('does not fuzz short words or change the first letter', () => {
    expect(rankSuggestions('pea', [p('Tea')], 5)).toEqual([])
    expect(rankSuggestions('milk', [p('Silk')], 5)).toEqual([])
    expect(rankSuggestions('nanana', pantry, 5)).toEqual([])
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

  it('is empty for a folded or typo match', () => {
    const [top] = rankSuggestions('butterbean', [p('Butter beans')], 1)
    expect(ghostRemainder('butterbean', top)).toBe('')
  })

  it('is empty when the match is not a prefix', () => {
    const [top] = rankSuggestions('arb', pantry, 1)
    expect(ghostRemainder('arb', top)).toBe('')
  })
})
