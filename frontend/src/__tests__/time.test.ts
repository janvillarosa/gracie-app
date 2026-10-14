import { getCategoryClass } from '@lib/category'
import { timeAgo } from '@lib/time'

describe('timeAgo', () => {
  const now = new Date('2026-01-01T12:00:00Z')
  it('handles missing and recent values', () => {
    expect(timeAgo(undefined, now)).toBe('less than a minute ago')
    expect(timeAgo('2026-01-01T11:59:40Z', now)).toBe('less than a minute ago')
  })
  it('formats minutes, hours and days', () => {
    expect(timeAgo('2026-01-01T11:55:00Z', now)).toMatch(/5 minutes ago/)
    expect(timeAgo('2026-01-01T09:00:00Z', now)).toMatch(/3 hours ago/)
    expect(timeAgo('2025-12-30T12:00:00Z', now)).toMatch(/2 days ago/)
  })
})

describe('getCategoryClass', () => {
  it('maps categories to classes with a general fallback', () => {
    expect(getCategoryClass('Fresh Produce')).toBe('cat-produce')
    expect(getCategoryClass('Eggs')).toBe('cat-dairy')
    expect(getCategoryClass('Grains & Bakery')).toBe('cat-bakery')
    expect(getCategoryClass(undefined)).toBe('cat-general')
    expect(getCategoryClass('Toys')).toBe('cat-general')
  })
})
