import type { ListSuggestion } from '@api/types'

type Props = {
  suggestion: ListSuggestion
  onAdd: (s: ListSuggestion) => void
  onIgnore: (s: ListSuggestion) => void
}

function cadence(days: number): string {
  if (days <= 1) return 'usually every day'
  if (days === 7) return 'usually every week'
  return `usually every ${days} days`
}

/** One thing the house usually adds around now, above the items. Never inside the list. */
export function SuggestionSlip({ suggestion, onAdd, onIgnore }: Props) {
  const { description, quantity, unit } = suggestion
  const label = [quantity, unit].filter(Boolean).length
    ? `${description} (${[quantity, unit].filter(Boolean).join(' ')})`
    : description
  return (
    <section className="suggestion-slip" aria-label="Suggested">
      <div className="suggestion-text">
        <span className="suggestion-name">{label}</span>
        <span className="suggestion-cadence">{cadence(suggestion.every_days)}</span>
      </div>
      <button
        type="button"
        className="suggestion-ignore"
        aria-label={`Ignore suggestion: ${description}`}
        onClick={() => onIgnore(suggestion)}
      >
        Ignore
      </button>
      <button
        type="button"
        className="suggestion-add"
        aria-label={`Add ${description}`}
        onClick={() => onAdd(suggestion)}
      >
        Add
      </button>
    </section>
  )
}
