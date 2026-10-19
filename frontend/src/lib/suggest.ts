import type { PantryItem } from '@api/types'
import { compactKey, levenshtein } from '@lib/itemKey'
import { parseInput } from '@lib/parseInput'

export type Suggestion = {
  item: PantryItem
  // Matched span inside item.description, for highlighting.
  start: number
  length: number
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

// How many edits a typo match may take: none under five letters (too many short words are a letter
// apart), one up to seven, two from eight.
const typoBudget = (len: number) => (len < 5 ? 0 : len < 8 ? 1 : 2)

// Whether the compact query is a typo or two away from the start of the compact name. The
// first letter must agree, and the prefix may run a letter short or long (a missed or
// doubled letter).
function nearPrefix(cq: string, cname: string): boolean {
  const budget = typoBudget(cq.length)
  if (!budget || cq[0] !== cname[0]) return false
  for (let n = cq.length - 1; n <= cq.length + 1; n++) {
    if (n <= cname.length && levenshtein(cq, cname.slice(0, n)) <= budget) return true
  }
  return false
}

/**
 * Ranks pantry entries against what the user has typed. The typed text is parsed first,
 * so "2 kg bas" matches on "bas". Tiers: name starts with the query, a later word starts
 * with it, (3+ chars) anywhere, the same once spacing and plurals are folded ("chick pea"
 * finds Chickpeas), then a typo away ("bananna" finds Bananas). Within a tier the pantry's
 * own order wins, which the backend sorts by how often and how recently the house bought it.
 * The last two tiers highlight the whole name, since no span of it was typed as such.
 */
export function rankSuggestions(input: string, pantry: PantryItem[], limit: number): Suggestion[] {
  const q = norm(parseInput(input).description)
  if (!q || limit <= 0) return []
  const cq = compactKey(q)
  const tiers: Suggestion[][] = [[], [], [], [], []]
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
    let length = q.length
    if (tier < 0 && cq) {
      const cname = compactKey(name)
      if (cname.startsWith(cq)) tier = 3
      else if (nearPrefix(cq, cname)) tier = 4
      at = 0
      length = name.length
    }
    if (tier < 0) continue
    tiers[tier].push({ item, start: at, length })
    if (tier === 0 && tiers[0].length >= limit) break
  }
  return tiers.flat().slice(0, limit)
}

/** Text to show faded after the caret when the top suggestion extends what was typed. */
export function ghostRemainder(input: string, top: Suggestion | undefined): string {
  if (!top || top.start !== 0) return ''
  const typed = parseInput(input).description
  const t = typed.trim()
  if (!t || input.includes('\n')) return ''
  // A folded or typo match also starts at 0, but its name doesn't extend what was typed.
  if (!top.item.description.toLowerCase().startsWith(t.toLowerCase())) return ''
  return top.item.description.slice(t.length)
}
