import { isValidDisplayName } from '@lib/validation'

describe('validation', () => {
  it('validates display name constraints', () => {
    expect(isValidDisplayName('')).toBe(false)
    expect(isValidDisplayName('Valid Name 123')).toBe(true)
    expect(isValidDisplayName('Bad!')).toBe(false)
    expect(isValidDisplayName('a'.repeat(65))).toBe(false)
  })
})

