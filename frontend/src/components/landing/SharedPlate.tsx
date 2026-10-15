import { TransitionLink } from '@components/TransitionLink'
import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { AddBarStill, Box, ListHead } from './appUi'
import { LearnsSheet } from './Capabilities'
import { categorize, type Stamp } from './demo'

type Row = {
  id: string
  text: string
  qty?: string
  stamp: Stamp | null
  fresh?: boolean
  done?: boolean
}

const START_ROWS: Row[] = [
  { id: 's1', text: 'Basmati rice', qty: '2 kg', stamp: { key: 'grains', label: 'Grains' } },
  { id: 's2', text: 'Lemons', qty: '4', stamp: { key: 'produce', label: 'Produce' } },
  { id: 's3', text: 'Sourdough', stamp: { key: 'bakery', label: 'Bakery' } },
  { id: 's4', text: 'Frozen peas', stamp: { key: 'frozen', label: 'Frozen' } },
]

// What gets typed, in turn. Each one is sorted into its aisle the way the app does it.
const TYPED = ['Oat milk', 'Bin bags', 'Eggs', 'Coffee', 'Cheddar', 'Sponges']

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/** The list, looking after itself: a line is typed into the add bar, and while it is typed another
 *  housemate ticks the bottom item off. On enter the new line lands on top with the highlighter and
 *  its aisle stamped on, and the ticked one folds away into "Show checked-off items", so the list
 *  stays the same length. It plays only while it is on screen, and holds a finished list when the
 *  visitor prefers reduced motion. Decorative: the heading and text beside it say the same thing. */
const TypingList: React.FC = () => {
  const [rows, setRows] = useState<Row[]>(START_ROWS)
  const [typed, setTyped] = useState('')
  const [checkedOff, setCheckedOff] = useState(1)
  const [visible, setVisible] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const turn = useRef(0)

  useEffect(() => {
    const el = card.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let live = true
    const run = async () => {
      while (live) {
        const word = TYPED[turn.current % TYPED.length]
        for (let c = 1; c <= word.length && live; c++) {
          setTyped(word.slice(0, c))
          // Halfway through typing, someone at the shop ticks the bottom item off.
          if (c === Math.ceil(word.length / 2)) {
            setRows((r) => {
              const last = [...r].reverse().find((x) => !x.done)
              return last ? r.map((x) => (x.id === last.id ? { ...x, done: true } : x)) : r
            })
          }
          await sleep(65 + Math.random() * 55)
        }
        await sleep(480)
        if (!live) return
        const id = `t${turn.current}`
        setRows((r) => [{ id, text: word, stamp: null, fresh: true }, ...r.filter((x) => !x.done)])
        setCheckedOff((n) => n + 1)
        setTyped('')
        await sleep(420)
        if (!live) return
        setRows((r) => r.map((x) => (x.id === id ? { ...x, stamp: categorize(x.text) } : x)))
        await sleep(1700)
        if (!live) return
        setRows((r) => r.map((x) => (x.id === id ? { ...x, fresh: false } : x)))
        await sleep(700)
        turn.current += 1
      }
    }
    run()
    return () => {
      live = false
    }
  }, [visible])

  return (
    <div className="ld-plate-card" data-ui aria-hidden="true" ref={card}>
      <div className="ld-app-card is-flat">
        <ListHead
          icon="🥦" // taste-skill-ignore: the app’s own list icon (lists pick an emoji)
          title="Groceries"
          meta="Weekly shop"
        />
        <ul className="ld-rows">
          {rows.map((r) => (
            <li
              key={r.id}
              className={['ld-row is-static', r.fresh ? 'is-fresh' : '', r.done ? 'is-done' : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="ld-row-hit">
                <Box done={r.done} />
                <span className="ld-row-title">
                  {r.text}
                  {r.qty && <span className="ld-qty">{r.qty}</span>}
                </span>
              </span>
              {r.stamp ? (
                <span className={`ld-stamp is-${r.stamp.key}`}>{r.stamp.label}</span>
              ) : (
                <span className="ld-stamp is-pending" />
              )}
            </li>
          ))}
        </ul>
        <p className="ld-done-toggle is-still">Show checked-off items ({checkedOff})</p>
        <AddBarStill text={typed || undefined} placeholder="Add an item" />
      </div>
    </div>
  )
}

/** The lists part: what the House's list is, a typing demonstration of how little there is to do,
 *  and what the add bar learns. */
export const SharedPlate: React.FC = () => {
  const base = useId()
  return (
    <>
      <section className="ld-shared" id="lists" aria-labelledby={`${base}-h`}>
        <div className="ld-plate" data-reveal>
          <TypingList />
        </div>
        <div className="ld-shared-copy">
          <div className="ld-shared-text">
            <h2 id={`${base}-h`} className="ld-h2" data-reveal>
              Lists for the house.
            </h2>
            <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
              No Notion template to build, no Google Sheet to share, no note to keep tidy. Type an
              item and Bauhouse sorts it into the right aisle. Everyone at home adds to the same
              list.
            </p>
          </div>
          <div className="ld-cells">
            <TransitionLink to="/register" className="ld-cell is-key">
              Try Bauhouse free
            </TransitionLink>
            <a href="#trips" className="ld-cell is-tone">
              See trip planning
            </a>
          </div>
        </div>
      </section>
      <div className="ld-lists-more">
        <LearnsSheet />
      </div>
    </>
  )
}
