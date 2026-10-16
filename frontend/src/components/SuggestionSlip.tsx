import { Plus, X } from '@phosphor-icons/react'
import type { ListSuggestion } from '@api/types'
import { Button } from '@components/ui'

type Props = {
  suggestion: ListSuggestion
  onAdd: (s: ListSuggestion) => void
  onIgnore: (s: ListSuggestion) => void
}

type StackProps = {
  suggestions: ListSuggestion[]
  onAdd: (s: ListSuggestion) => void
  onIgnore: (s: ListSuggestion) => void
  phase?: SlipPhase
}

/** A taken or ignored slip keeps its slot: it pops out (leaving), stays invisible while the server
 *  answers (held), and the slot closes only when nothing follows (collapsing). */
export type SlipPhase = 'leaving' | 'held' | 'collapsing'

function cadence(days: number): string {
  if (days <= 1) return 'You add it daily'
  if (days === 7) return 'You add it weekly'
  if (days % 7 === 0 && days <= 28) return `You add it every ${days / 7} weeks`
  if (days >= 28 && days <= 31) return 'You add it monthly'
  return `You add it every ${days} days`
}

/** What the house usually adds around now: one sheet of paper above the items (never inside the
 *  list). Its Add is the page's one yellow key, so the eye finds it without anything shouting. */
export function SuggestionStack({ suggestions, onAdd, onIgnore, phase }: StackProps) {
  if (suggestions.length === 0) return null
  return (
    // The wrappers only exist so the list below can glide down as the slip arrives (see styles.css).
    <div className={phase ? `suggestion-reveal is-${phase}` : 'suggestion-reveal'}>
      <div className="suggestion-clip">
        <section key={suggestions[0].key} className="suggestion-sheet" aria-label="Suggestion">
          <ul className="suggestion-rows">
            {suggestions.map((s) => (
              <SuggestionSlip key={s.key} suggestion={s} onAdd={onAdd} onIgnore={onIgnore} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** One row: the thing and its rhythm, a quiet Add, and a round "not now". */
export function SuggestionSlip({ suggestion, onAdd, onIgnore }: Props) {
  const { description, quantity, unit } = suggestion
  const amount = [quantity, unit].filter(Boolean).join(' ')
  const label = amount ? `${description} (${amount})` : description
  return (
    <li className="suggestion-row">
      <div className="suggestion-text">
        <span className="suggestion-name" title={label}>
          {label}
        </span>
        <span className="suggestion-cadence">{cadence(suggestion.every_days)}</span>
      </div>
      <Button
        kind="key"
        className="suggestion-add"
        icon={<Plus size={16} weight="bold" aria-hidden />}
        aria-label={`Add ${description}`}
        onClick={() => onAdd(suggestion)}
      >
        Add
      </Button>
      <Button
        iconOnly
        title="Not now"
        aria-label={`Ignore suggestion: ${description}`}
        onClick={() => onIgnore(suggestion)}
      >
        <X size={18} aria-hidden />
      </Button>
    </li>
  )
}
