import { Plus } from '@phosphor-icons/react'
import React, { useEffect, useReducer, useRef, useState } from 'react'
import { Box, ListHead } from './appUi'
import { confettiFrom } from './confetti'
import {
  cleanEntry,
  type DemoItem,
  demoReducer,
  initialDemo,
  MAX_DEMO_ADDS,
  MAX_DEMO_TEXT,
  mateStep,
} from './demo'

const Row: React.FC<{ item: DemoItem; onToggle: (id: string) => void }> = React.memo(
  ({ item, onToggle }) => (
    <li
      data-row={item.id}
      className={['ld-row', item.done ? 'is-done' : '', item.fresh ? 'is-fresh' : '']
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
// How often a housemate adds a line, and how long the list gets before the oldest is ticked off.
const MATE_EVERY_MS = 4200
const MATE_MAX_OPEN = 4
const FIRST_NOTE = 'Tick something off here and it’s ticked off on everyone’s phone.'

/** Starts while the list is on screen, unless the visitor prefers reduced motion. */
function useOnScreen(el: React.RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const node = el.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.3 })
    io.observe(node)
    return () => io.disconnect()
  }, [el])
  return on
}

/** The first screen's list, drawn like the List page: a short week's list that the housemates
 *  keep adding to while it's on screen (the oldest line is ticked off so it stays short), and an
 *  add bar that really adds. The housemates wait while the visitor types. Sam ticks the
 *  visitor's first line a moment later, and ticked lines fold away under "Show checked-off
 *  items" the way the app does it. Nothing leaves the browser. */
export const HeroSheet: React.FC<{ mateEveryMs?: number }> = ({ mateEveryMs = MATE_EVERY_MS }) => {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialDemo)
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [note, setNote] = useState(FIRST_NOTE)
  const [typing, setTyping] = useState(false)
  const timers = useRef<number[]>([])
  const samTicked = useRef(false)
  const card = useRef<HTMLDivElement>(null)
  const mateTurn = useRef(0)
  const latest = useRef(state)
  latest.current = state
  const onScreen = useOnScreen(card)
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

  // The housemates' lines: tick the oldest when the list is long, then add the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `later` only queues timers
  useEffect(() => {
    if (!onScreen || typing) return
    const id = window.setInterval(() => {
      const { tick, next } = mateStep(latest.current, mateTurn.current, MATE_MAX_OPEN)
      if (tick) {
        // Someone else's tick: no confetti, which the app keeps for your own.
        dispatch({ type: 'tick', id: tick })
        later(() => dispatch({ type: 'archive', id: tick }), FOLD_MS)
      }
      if (!next) return
      mateTurn.current = next.turn + 1
      const lineId = `m${next.turn}`
      // The new line lands a beat after the tick, gets its stamp, then the highlighter dries.
      const beat = mateEveryMs / 7
      later(() => {
        dispatch({ type: 'mateAdd', id: lineId, text: next.add.text, stamp: next.add.stamp })
        setNote(`${next.add.who} added ${next.add.text.toLowerCase()}.`)
      }, beat)
      later(() => dispatch({ type: 'stamp', id: lineId }), beat * 1.7)
      later(() => dispatch({ type: 'settle', id: lineId }), beat * 3.8)
    }, mateEveryMs)
    return () => window.clearInterval(id)
  }, [onScreen, typing, mateEveryMs])

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
    <div className="ld-stack" data-ui ref={card}>
      <div className="ld-app-card is-meta">
        <ListHead
          as="h2"
          icon="🏡" // taste-skill-ignore: the app’s own list icon (lists pick an emoji)
          title="This week"
          meta={`${toGet} to get · updated just now`}
          mates
        />
      </div>
      <div className="ld-app-card is-list">
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
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
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
        <span key={note}>{note}</span>
      </p>
    </div>
  )
}
