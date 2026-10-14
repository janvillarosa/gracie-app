import type { PantryItem } from '@api/types'
import { parseInput } from '@lib/parseInput'

export type Suggestion = {
  item: PantryItem
  // Matched span inside item.description, for highlighting.
  start: number
  length: number
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Ranks pantry entries against what the user has typed. The typed text is parsed first,
 * so "2 kg bas" matches on "bas". Tiers: name starts with the query, a later word starts
 * with it, then (3+ chars) anywhere. Within a tier the pantry's own order wins, which the
 * backend sorts by how often and how recently the house bought it.
 */
export function rankSuggestions(input: string, pantry: PantryItem[], limit: number): Suggestion[] {
  const q = norm(parseInput(input).description)
  if (!q || limit <= 0) return []
  const tiers: Suggestion[][] = [[], [], []]
  for (const item of pantry) {
    const name = item.description
    const lower = name.toLowerCase()
    if (norm(name) === q) continue
    let tier = -1
    let at = -1
    if (lower.startsWith(q)) {
      tier = 0
      at = 0
    } else {
      at = lower.indexOf(` ${q}`)
      if (at >= 0) {
        tier = 1
        at += 1
      } else if (q.length >= 3) {
        at = lower.indexOf(q)
        if (at >= 0) tier = 2
      }
    }
    if (tier < 0) continue
    tiers[tier].push({ item, start: at, length: q.length })
    if (tier === 0 && tiers[0].length >= limit) break
  }
  return tiers.flat().slice(0, limit)
}

/** Text to show faded after the caret when the top suggestion extends what was typed. */
export function ghostRemainder(input: string, top: Suggestion | undefined): string {
  if (!top || top.start !== 0) return ''
  const typed = parseInput(input).description
  if (!typed || input.includes('\n')) return ''
  return top.item.description.slice(typed.trim().length)
}
