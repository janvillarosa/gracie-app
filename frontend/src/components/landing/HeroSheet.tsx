import { Plus } from '@phosphor-icons/react'
import React, { useEffect, useReducer, useRef, useState } from 'react'
import { Box, ListHead, Pills } from './appUi'
import { confettiFrom } from './confetti'
import {
  cleanEntry,
  type DemoItem,
  demoReducer,
  initialDemo,
  MAX_DEMO_ADDS,
  MAX_DEMO_TEXT,
} from './demo'

const Row: React.FC<{ item: DemoItem; onToggle: (id: string) => void }> = React.memo(
  ({ item, onToggle }) => (
    <li
      data-row={item.id}
      className={[
        'ld-row',
        item.done ? 'is-done' : '',
        item.fresh ? 'is-fresh' : '',
        item.marked ? 'is-marked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <label className="ld-row-hit">
        <input
          type="checkbox"
          className="ld-check-input"
          checked={item.done}
          onChange={() => onToggle(item.id)}
        />
        <Box done={item.done} />
        <span className="ld-row-title">{item.text}</span>
      </label>
      {item.stamp ? (
        <span className={`ld-stamp is-${item.stamp.key}`}>{item.stamp.label}</span>
      ) : (
        <span className="ld-stamp is-pending" aria-hidden="true" />
      )}
    </li>
  ),
)

const FOLD_MS = 1100

/** The first screen's list, drawn like the List page: the four reasons as the House's list, and
 *  an add bar that really adds. Sam ticks the visitor's first line a moment later, and ticked
 *  lines fold away under "Show checked-off items" the way the app does it. Nothing leaves the
 *  browser. */
export const HeroSheet: React.FC = () => {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo)
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState('')
  const [showDone, setShowDone] = useState(false)
  const timers = useRef<number[]>([])
  const samTicked = useRef(false)
  const full = state.adds >= MAX_DEMO_ADDS

  useEffect(() => {
    const t = timers.current
    return () => {
      for (const id of t) window.clearTimeout(id)
    }
  }, [])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  const onToggle = React.useCallback((id: string) => {
    // Confetti only when a line gets ticked, from its own checkbox.
    const box = document.querySelector(`[data-row="${id}"] .ld-box`)
    if (box && !box.classList.contains('is-done')) confettiFrom(box)
    dispatch({ type: 'toggle', id })
    timers.current.push(window.setTimeout(() => dispatch({ type: 'archive', id }), FOLD_MS))
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = cleanEntry(draft)
    if (!text || full) return
    const id = `v${state.seq + 1}`
    dispatch({ type: 'add', text: draft })
    setDraft('')
    setSaid(`Added ${text}.`)
    // The category is stamped on a beat later, as it is in the app.
    later(() => dispatch({ type: 'stamp', id }), 420)
    later(() => dispatch({ type: 'settle', id }), 1700)
    if (!samTicked.current) {
      samTicked.current = true
      later(() => {
        confettiFrom(document.querySelector(`[data-row="${id}"] .ld-box`))
        dispatch({ type: 'tick', id })
        setSaid(`Sam got ${text}.`)
      }, 2600)
      later(() => dispatch({ type: 'archive', id }), 2600 + FOLD_MS)
    }
  }

  const open = state.items.filter((i) => !i.archived)
  const checkedOff = state.items.filter((i) => i.archived)
  const toGet = state.items.filter((i) => !i.done).length

  return (
    <div className="ld-stack" data-ui>
      <div className="ld-app-card is-meta">
        <ListHead
          as="h2"
          icon="🏡" // taste-skill-ignore: the app’s own list icon (lists pick an emoji)
          title="Why Bauhouse"
          meta={`${toGet} to get · updated just now`}
          mates
        />
      </div>
      <div className="ld-app-card is-list">
        <Pills tabs={['Items', 'Notes']} on={0} count={toGet} />
        <ul className="ld-rows" aria-label="The House’s list">
          {open.map((item) => (
            <Row key={item.id} item={item} onToggle={onToggle} />
          ))}
        </ul>
        {checkedOff.length > 0 && (
          <>
            <button
              type="button"
              className="ld-done-toggle"
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone
                ? 'Hide checked-off items'
                : `Show checked-off items (${checkedOff.length})`}
            </button>
            {showDone && (
              <ul className="ld-rows is-checked-off" aria-label="Checked-off items">
                {checkedOff.map((item) => (
                  <Row key={item.id} item={item} onToggle={onToggle} />
                ))}
              </ul>
            )}
          </>
        )}
        <form className="ld-addbar" onSubmit={onSubmit}>
          <span className="ld-addbar-field">
            <input
              className="ld-addbar-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_DEMO_TEXT + 20}
              disabled={full}
              aria-label="Add an item"
              placeholder={full ? 'This list is full' : 'Add an item. Try “oat milk”'}
              enterKeyHint="done"
              autoComplete="off"
            />
          </span>
          <button
            className={draft.trim() ? 'ld-addbar-btn is-armed' : 'ld-addbar-btn'}
            type="submit"
            disabled={full || !draft.trim()}
            aria-label="Add"
          >
            <Plus weight="bold" aria-hidden="true" />
          </button>
        </form>
        {full && (
          <p className="ld-sheet-note">That’s a full list. Create a free account to keep adding.</p>
        )}
        <p className="ld-sr" aria-live="polite">
          {said}
        </p>
      </div>
      <p className="ld-margin-note" aria-hidden="true">
        Tick something off here and it’s ticked off on everyone’s phone.
      </p>
    </div>
  )
}
