import type React from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { AddBarStill, Box, ListHead } from './appUi'
import { SetWords } from './SetWords'
import { useScrollProgress } from './useScrollProgress'
import { categorize, PLATE_START, PLATE_WORDS, type PlateRow, plateLand, plateTick } from './demo'

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/** The list, looking after itself: a line is typed into the add bar (which suggests it from the
 *  second letter), and while it is typed another housemate ticks the bottom item off. On enter the
 *  new line lands on top with the highlighter and its section stamped on, and the ticked one folds away into "Show checked-off items", so the list
 *  stays the same length. It plays only while it is on screen, and holds a finished list when the
 *  visitor prefers reduced motion. Decorative: the heading and text beside it say the same thing. */
const TypingList: React.FC = () => {
  const [rows, setRows] = useState<PlateRow[]>(PLATE_START)
  const [typed, setTyped] = useState('')
  const [checkedOff, setCheckedOff] = useState(1)
  const [visible, setVisible] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const turn = useRef(0)
  const seq = useRef(0)

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
        const word = PLATE_WORDS[turn.current % PLATE_WORDS.length]
        for (let c = 1; c <= word.length && live; c++) {
          setTyped(word.slice(0, c))
          // Halfway through typing, someone at the shop ticks the bottom item off.
          if (c === Math.ceil(word.length / 2)) setRows(plateTick)
          await sleep(65 + Math.random() * 55)
        }
        await sleep(480)
        if (!live) return
        // Move on as soon as the line lands, so leaving and coming back never retypes it, and
        // give every line its own id.
        turn.current += 1
        seq.current += 1
        const id = `t${seq.current}`
        setRows((r) => plateLand(r, word, id))
        setCheckedOff((n) => n + 1)
        setTyped('')
        await sleep(420)
        if (!live) return
        setRows((r) => r.map((x) => (x.id === id ? { ...x, stamp: categorize(x.text) } : x)))
        await sleep(1700)
        if (!live) return
        setRows((r) => r.map((x) => (x.id === id ? { ...x, fresh: false } : x)))
        await sleep(700)
      }
    }
    run()
    return () => {
      live = false
    }
  }, [visible])

  // From the second letter the add bar suggests what this house buys, as it does in the app.
  const word = PLATE_WORDS[turn.current % PLATE_WORDS.length]
  const suggest = typed.length >= 2 && typed.length < word.length ? word : null

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
        <div className="ld-plate-bar">
          {suggest && (
            <ul className="ld-slips is-rising">
              <li className="is-hot">
                <span>
                  <b>{suggest.slice(0, typed.length)}</b>
                  {suggest.slice(typed.length)}
                </span>
                <span className={`ld-stamp is-${categorize(suggest).key}`}>
                  {categorize(suggest).label}
                </span>
              </li>
            </ul>
          )}
          <AddBarStill text={typed || undefined} placeholder="Add an item" />
        </div>
      </div>
    </div>
  )
}

/** The lists part: what the House's list is, and a typing demonstration of how little there is
 *  to do. */
export const SharedPlate: React.FC = () => {
  const base = useId()
  const section = useRef<HTMLElement>(null)
  // The red square slides in from the edge and the list lands on it as the part scrolls in.
  useScrollProgress(section, 'through')
  return (
    <section className="ld-shared" id="lists" aria-labelledby={`${base}-h`} ref={section}>
      <div className="ld-plate" data-reveal>
        <TypingList />
      </div>
      <div className="ld-shared-copy">
        <SetWords
          id={`${base}-h`}
          className="ld-h2"
          lines={['Lists for', 'the house.']}
          accent={{ word: 'house', tone: 'red' }}
        />
        <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
          Type “oat milk” and it goes under Dairy on its own. After two letters Bauhouse suggests
          what your house buys every week, so you rarely type a whole word. Everyone at home adds to
          the same list.
        </p>
      </div>
    </section>
  )
}
