import { CallBell, Plus, X } from '@phosphor-icons/react'
import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { Box, ListHead } from './appUi'
import {
  BUTLER_ADDED,
  BUTLER_MOMENTS,
  BUTLER_ROUTE,
  BUTLER_SUGGESTION,
  type ButlerMoment,
  type ButlerRow,
  butlerStep,
} from './butlerWeek'
import { SetWords } from './SetWords'

// How long each moment holds before the next comes round, and when inside it the moment plays
// out (the suggestion is taken; the first pick is ticked). Matches the rule's fill in landing.css.
const HOLD_MS = 6400
const STEP_MS = 2600

/** The bell stamp a row carries when Butler put it on the list (the app's `.item-auto`). */
const Bell: React.FC = () => (
  <span className="ld-bell" aria-hidden="true">
    <CallBell weight="bold" />
  </span>
)

/** The slip lying on the list's sheet above the items, as each moment's slip looks in the app. */
const Slip: React.FC<{ moment: ButlerMoment; stepped: boolean }> = ({ moment, stepped }) => {
  if (moment.key === 'suggest') {
    if (stepped) return null
    return (
      <div className="ld-bslip is-suggest">
        <span className="ld-bslip-text">
          <span className="ld-bslip-name">{BUTLER_SUGGESTION.text}</span>
          <span className="ld-bslip-meta">{BUTLER_SUGGESTION.cadence}</span>
        </span>
        <span className="ld-bslip-add">
          <Plus weight="bold" />
          Add
        </span>
        <span className="ld-bslip-x">
          <X weight="bold" />
        </span>
      </div>
    )
  }
  if (moment.key === 'assist') {
    return (
      <div className="ld-bslip">
        <span className="ld-bslip-well">
          <CallBell weight="bold" />
        </span>
        <span className="ld-bslip-text">
          <span className="ld-bslip-name">Added {BUTLER_ADDED.length} for Saturday</span>
          <span className="ld-bslip-meta">{BUTLER_ADDED.join(', ')}</span>
        </span>
        <span className="ld-bslip-quiet">Undo all</span>
        <span className="ld-bslip-x">
          <X weight="bold" />
        </span>
      </div>
    )
  }
  // Up next hands itself to the next pick in place once the first is ticked.
  const at = stepped ? 1 : 0
  return (
    <div className="ld-bslip is-upnext" key={at}>
      <Box />
      <span className="ld-bslip-text">
        <span className="ld-bslip-name">{BUTLER_ROUTE[at]}</span>
        <span className="ld-bslip-meta">
          <Bell />
          Usually next · then {BUTLER_ROUTE[at + 1]}
        </span>
      </span>
      <span className="ld-bslip-x">
        <X weight="bold" />
      </span>
    </div>
  )
}

const Row: React.FC<{ row: ButlerRow; why?: boolean }> = ({ row, why }) => (
  <li
    className={['ld-row is-static', row.done ? 'is-done' : '', row.fresh ? 'is-fresh' : '']
      .filter(Boolean)
      .join(' ')}
  >
    <span className="ld-row-hit">
      <Box done={row.done} />
      <span className="ld-brow-words">
        <span className="ld-row-title">{row.text}</span>
        {why && <span className="ld-brow-why">Added by Butler. You buy it about every 9 days</span>}
      </span>
    </span>
    <span className="ld-brow-stamps">
      {row.bell && <Bell />}
      <span className={`ld-stamp is-${row.stamp.key}`}>{row.stamp.label}</span>
    </span>
  </li>
)

/** The House's Groceries list on the moment's day: the slip Butler puts in front, then the items.
 *  Decorative: the step beside it says the same in words. */
const ButlerSheet: React.FC<{ moment: ButlerMoment; stepped: boolean }> = ({ moment, stepped }) => {
  const rows = stepped ? butlerStep(moment) : moment.rows
  const live = rows.filter((r) => !r.done)
  const done = rows.length - live.length
  return (
    <div className="ld-app-card is-flat ld-bsheet" key={moment.key}>
      <ListHead
        icon="🥦" // taste-skill-ignore: the app’s own list icon (lists pick an emoji)
        title="Groceries"
        meta={`${moment.when} · ${moment.meta}`}
      />
      <Slip moment={moment} stepped={stepped} />
      <ul className="ld-rows">
        {live.map((r, i) => (
          <Row key={r.id} row={r} why={moment.key === 'assist' && i === 0} />
        ))}
      </ul>
      {done > 0 && <p className="ld-done-toggle is-still">Show checked-off items ({done})</p>}
    </div>
  )
}

/** Butler: what the House's habits buy it, as one week on one list. Three moments (before you
 *  run out, before the shop, in the shop) are tabs laid out as the week under the sheet; while the part is on screen
 *  they come round by themselves, each rule filling as its moment holds, until the visitor picks
 *  one. With reduced motion nothing turns by itself and nothing plays out. */
export const Butler: React.FC = () => {
  const base = useId()
  const [at, setAt] = useState(0)
  const [stepped, setStepped] = useState(false)
  const [visible, setVisible] = useState(false)
  // Once the visitor picks a moment, the page stops choosing for them.
  const [held, setHeld] = useState(false)
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = stage.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const still =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new moment restarts its clock
  useEffect(() => {
    setStepped(false)
    if (!visible || still) return
    const step = window.setTimeout(() => setStepped(true), STEP_MS)
    const next = held
      ? 0
      : window.setTimeout(() => setAt((n) => (n + 1) % BUTLER_MOMENTS.length), HOLD_MS)
    return () => {
      window.clearTimeout(step)
      window.clearTimeout(next)
    }
  }, [at, visible, held, still])

  const pick = (i: number) => {
    setHeld(true)
    setAt(i)
  }

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = BUTLER_MOMENTS.length - 1
    let n: number
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = i === last ? 0 : i + 1
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = i === 0 ? last : i - 1
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = last
    else return
    e.preventDefault()
    pick(n)
    document.getElementById(`${base}-tab-${n}`)?.focus()
  }

  const moment = BUTLER_MOMENTS[at]
  const running = visible && !held && !still

  return (
    <section className="ld-butler" id="butler" aria-labelledby={`${base}-h`}>
      <div className="ld-butler-copy">
        <SetWords
          id={`${base}-h`}
          className="ld-h2"
          lines={['Meet', 'Butler.']}
          accent={{ word: 'Butler', tone: 'mark' }}
        />
        <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
          Every House comes with a butler, and there’s nothing to set up. It pays attention to what
          you add and when you shop, down to the order you tick things off in. After a few weeks it
          starts handling the small next step for you.
        </p>
        <p className="ld-butler-promise">
          <CallBell weight="bold" aria-hidden="true" />
          <span>
            Anything Butler puts on a list carries its bell and can be undone. It never buys or
            books anything for you.
          </span>
        </p>
      </div>
      <div
        className="ld-butler-stage"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${at}`}
        ref={stage}
      >
        <div className="ld-butler-desk" data-ui aria-hidden="true">
          <ButlerSheet moment={moment} stepped={stepped} />
        </div>
        <p className="ld-sr">{moment.scene}</p>
      </div>
      <div className="ld-moments" role="tablist" aria-label="A week with Butler">
        {BUTLER_MOMENTS.map((m, i) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-selected={at === i}
            aria-controls={`${base}-panel`}
            tabIndex={at === i ? 0 : -1}
            className={[
              'ld-moment',
              at === i ? 'is-on' : '',
              at === i && running ? 'is-running' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ '--hold': `${HOLD_MS}ms` } as React.CSSProperties}
            onClick={() => pick(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <span className="ld-moment-rule" aria-hidden="true" />
            <span className="ld-moment-when">{m.when}</span>
            <span className="ld-moment-title">{m.title}</span>
            <span className="ld-moment-text">{m.text}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
