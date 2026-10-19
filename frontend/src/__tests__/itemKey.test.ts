import { compactKey, levenshtein } from '@lib/itemKey'

describe('compactKey', () => {
  // The same cases as backend/internal/parse/similar_test.go.
  it.each([
    ['oranges', 'orange'],
    ['orange', 'orange'],
    ['butter beans', 'butterbean'],
    ['butterbeans', 'butterbean'],
    ['berries', 'berry'],
    ['tomatoes', 'tomato'],
    ['peaches', 'peach'],
    ['boxes', 'box'],
    ['glasses', 'glass'],
    ['cheeses', 'cheese'],
    ['hummus', 'hummus'],
    ['swiss', 'swiss'],
    ['half-and-half', 'halfandhalf'],
    ['eggs', 'egg'],
  ])('%s -> %s', (input, want) => {
    expect(compactKey(input)).toBe(want)
  })

  it('folds case and extra spacing', () => {
    expect(compactKey('  Chick  Peas ')).toBe('chickpea')
  })
})

describe('levenshtein', () => {
  it('counts single edits', () => {
    expect(levenshtein('bananna', 'banana')).toBe(1)
    expect(levenshtein('brocoli', 'broccoli')).toBe(1)
    expect(levenshtein('', 'abc')).toBe(3)
    expect(levenshtein('rice', 'rice')).toBe(0)
  })
})
