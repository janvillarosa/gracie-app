export function getCategoryClass(cat?: string): string {
  if (!cat) return 'cat-general'
  const c = cat.toLowerCase()
  if (c.includes('produce')) return 'cat-produce'
  if (c.includes('dairy') || c.includes('egg')) return 'cat-dairy'
  if (c.includes('bakery') || c.includes('grain')) return 'cat-bakery'
  if (c.includes('meat') || c.includes('seafood')) return 'cat-meat'
  if (c.includes('frozen')) return 'cat-frozen'
  if (c.includes('plant')) return 'cat-plant'
  if (c.includes('pantry')) return 'cat-pantry'
  if (c.includes('beverage')) return 'cat-beverages'
  if (c.includes('household')) return 'cat-household'
  return 'cat-general'
}
