import { Plus, X } from '@phosphor-icons/react'
import type { ListSuggestion } from '@api/types'
import { Button, useMedia } from '@components/ui'

/** A narrow phone: the Add key goes round (a plus) so the name keeps the room. */
export const NARROW_SLIP = '(max-width: 400px)'

type Props = {
  suggestion: ListSuggestion
  onAdd: (s: ListSuggestion) => void
  onIgnore: (s: ListSuggestion) => void
  /** Mid-shop: the slip offers what comes due before the next shop. */
  during?: 'run'
}

type StackProps = {
  suggestions: ListSuggestion[]
  onAdd: (s: ListSuggestion) => void
  onIgnore: (s: ListSuggestion) => void
  phase?: SlipPhase
  during?: 'run'
}

/** A taken or ignored slip keeps its slot: it pops out (leaving), stays invisible while the server
 *  answers (held), and the slot closes only when nothing follows (collapsing). */
export type SlipPhase = 'leaving' | 'held' | 'collapsing'

/** Run mode: grab it while you're there. */
function dueLine(days: number | undefined): string {
  if (!days || days <= 0) return 'Due now'
  if (days === 1) return 'Usually due tomorrow'
  return `Usually due in ${days} days`
}

function cadence(days: number): string {
  if (days <= 1) return 'You add it daily'
  if (days === 7) return 'You add it weekly'
  if (days % 7 === 0 && days <= 28) return `You add it every ${days / 7} weeks`
  if (days >= 28 && days <= 31) return 'You add it monthly'
  return `You add it every ${days} days`
}

/** What the house usually adds around now: one sheet of paper above the items (never inside the
 *  list). Its Add is the page's one yellow key, so the eye finds it without anything shouting. */
export function SuggestionStack({ suggestions, onAdd, onIgnore, phase, during }: StackProps) {
  if (suggestions.length === 0) return null
  return (
    // The wrappers only exist so the list below can glide down as the slip arrives (see styles.css).
    <div className={phase ? `suggestion-reveal is-${phase}` : 'suggestion-reveal'}>
      <div className="suggestion-clip">
        <section key={suggestions[0].key} className="suggestion-sheet" aria-label="Suggestion">
          <ul className="suggestion-rows">
            {suggestions.map((s) => (
              <SuggestionSlip
                key={s.key}
                suggestion={s}
                onAdd={onAdd}
                onIgnore={onIgnore}
                during={during}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** One row: the thing and its rhythm, a quiet Add, and a round "not now". */
export function SuggestionSlip({ suggestion, onAdd, onIgnore, during }: Props) {
  const { description, quantity, unit } = suggestion
  const amount = [quantity, unit].filter(Boolean).join(' ')
  const label = amount ? `${description} (${amount})` : description
  const narrow = useMedia(NARROW_SLIP)
  return (
    <li className="suggestion-row">
      <div className="suggestion-text">
        <span className="suggestion-name" title={label}>
          {label}
        </span>
        <span className="suggestion-cadence">
          {during === 'run' ? dueLine(suggestion.due_in_days) : cadence(suggestion.every_days)}
        </span>
      </div>
      <Button
        kind="key"
        iconOnly={narrow}
        className="suggestion-add"
        icon={<Plus size={16} weight="bold" aria-hidden />}
        aria-label={`Add ${description}`}
        onClick={() => onAdd(suggestion)}
      >
        {narrow ? null : 'Add'}
      </Button>
      <Button
        iconOnly
        title={during === 'run' ? 'Not this time' : 'Not now'}
        aria-label={`Ignore suggestion: ${description}`}
        onClick={() => onIgnore(suggestion)}
      >
        <X size={18} aria-hidden />
      </Button>
    </li>
  )
}
