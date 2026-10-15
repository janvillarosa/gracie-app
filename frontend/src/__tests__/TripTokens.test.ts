import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(resolve(__dirname, '../styles.css'), 'utf8')
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(styles)
  if (!m) throw new Error(`missing token --${name}`)
  return m[1]
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('map pip colours', () => {
  const ground = token('trip-map-ground')
  const cats = ['food', 'sight', 'activity', 'transport', 'stay', 'shopping', 'other']

  it.each(cats)('the %s pip is at least 3:1 against the map ground', (c) => {
    expect(ratio(token(`pip-${c}`), ground)).toBeGreaterThanOrEqual(3)
  })

  it('has seven distinct hues, plus a muted grey for a stop that is done', () => {
    const hues = cats.map((c) => token(`pip-${c}`))
    expect(new Set(hues).size).toBe(7)
    expect(token('pip-done')).not.toBe(token('pip-other'))
  })

  it('draws day colours against the ground at 3:1 too', () => {
    for (let i = 0; i < 6; i++)
      expect(ratio(token(`trip-day-${i}`), ground)).toBeGreaterThanOrEqual(3)
  })
})
