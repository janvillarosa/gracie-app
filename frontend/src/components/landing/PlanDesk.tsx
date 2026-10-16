import {
  BatteryFull,
  Check,
  Circle,
  DotsSixVertical,
  MagnifyingGlass,
  Minus,
  Plus,
  WifiHigh,
} from '@phosphor-icons/react'
import type React from 'react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { AddBarStill, Box, Housemates, Pills } from './appUi'
import { confettiFrom } from './confetti'
import { DeviceFit } from './DeviceFit'
import { initialPlan, PLAN_DAYS, planMove, planPins, planReady } from './demo'
import { PortoMap } from './PortoMap'

const DAY_NAME = { sat: 'Saturday', sun: 'Sunday' } as const

/** On its own, while it is on screen, the first ideas land on their days one after another. */
const AUTOPLAY_MS = 2400

/** The planning view: the trip as it looks on a laptop. Ideas on the left until someone picks a
 *  day for them (tap one), the days in the middle filling in time order, "Ready to go?" saying what
 *  is still missing until nothing is, and the map of Porto on the right, where a stop's pill drops
 *  in as it lands. Drawn from the app's own desk; nothing leaves the browser. */
export const PlanDesk: React.FC<{ autoplayMs?: number }> = ({ autoplayMs = AUTOPLAY_MS }) => {
  const [plan, move] = useReducer(planMove, undefined, initialPlan)
  const [said, setSaid] = useState('')
  const [onScreen, setOnScreen] = useState(false)
  const touched = useRef(false)
  const wasReady = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const days = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLSpanElement>(null)
  const latest = useRef(plan)
  latest.current = plan

  const lines = planReady(plan)
  const ready = lines.every((l) => l.ok)
  const pins = planPins(plan)
  const target = PLAN_DAYS.find((d) => plan.days[d.key].length === 0) ?? PLAN_DAYS[1]

  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Two ideas land by themselves, then it is the visitor's turn. Any tap ends the show.
  useEffect(() => {
    if (!onScreen) return
    const id = window.setInterval(() => {
      const next = latest.current.ideas.find((i) => i.id === 'i1' || i.id === 'i2')
      if (touched.current || !next) return window.clearInterval(id)
      pick(next.id, next.what, next.day)
    }, autoplayMs)
    return () => window.clearInterval(id)
    // biome-ignore lint/correctness/useExhaustiveDependencies: `pick` only dispatches
  }, [onScreen, autoplayMs])

  // The moment the trip becomes ready, the tick pops with confetti, as a ticked item does.
  useEffect(() => {
    if (ready && !wasReady.current) confettiFrom(mark.current)
    wasReady.current = ready
  }, [ready])

  // A stop that lands below the fold of the days column scrolls into view inside that column
  // (never the page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a stop lands
  useEffect(() => {
    const box = days.current
    const row = box?.querySelector<HTMLElement>('.ld-dayrow.is-fresh')
    if (!box || !row || typeof box.scrollTo !== 'function') return
    const top = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({ top: Math.max(0, top), behavior: calm ? 'auto' : 'smooth' })
  }, [plan])

  function pick(id: string, what: string, day: keyof typeof DAY_NAME) {
    move(id)
    setSaid(`${what} is on ${DAY_NAME[day]}.`)
  }

  return (
    <DeviceFit max={1.5}>
      <div className="device device-macbook-pro" data-ui ref={root}>
        <div className="device-frame">
          <div className="device-screen ld-device-screen">
            <div className="ld-laptop-ui">
              <div className="ld-laptop-menubar" aria-hidden="true">
                <b>Bauhouse</b>
                <span className="ld-laptop-menus">
                  <MagnifyingGlass weight="bold" />
                  <WifiHigh weight="bold" />
                  <BatteryFull weight="fill" />
                  <span>Thu 9:41</span>
                </span>
              </div>
              <div className="ld-desk">
                <aside className="ld-desk-ideas" aria-label="Ideas">
                  <p className="ld-desk-head">
                    <span>Ideas · {plan.ideas.length}</span>
                    <span className="ld-desk-hint">Tap one to place it</span>
                  </p>
                  {plan.ideas.length > 0 ? (
                    <ul>
                      {plan.ideas.map((i) => (
                        <li key={i.id}>
                          <button
                            type="button"
                            className="ld-idea"
                            aria-label={`Put ${i.what} on ${DAY_NAME[i.day]} at ${i.time}`}
                            onClick={() => {
                              touched.current = true
                              pick(i.id, i.what, i.day)
                            }}
                          >
                            <DotsSixVertical
                              weight="bold"
                              className="ld-idea-grip"
                              aria-hidden="true"
                            />
                            <span className={`ld-pip is-${i.pip}`} aria-hidden="true" />
                            <span className="ld-idea-text">
                              <span className="ld-idea-what">{i.what}</span>
                              {i.place && <span className="ld-idea-place">{i.place}</span>}
                            </span>
                            <span className="ld-idea-to" aria-hidden="true">
                              {PLAN_DAYS.find((d) => d.key === i.day)?.label}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ld-plan-empty">Every idea has a day.</p>
                  )}
                </aside>

                <section className="ld-desk-main" aria-label="Weekend in Porto">
                  <div className="ld-trip-head">
                    <span className="ld-app-icon" aria-hidden="true">
                      🧳 {/* taste-skill-ignore: the app’s own trip icon */}
                    </span>
                    <div className="ld-trip-titles">
                      <h4 className="ld-trip-title">Weekend in Porto</h4>
                      <p className="ld-app-meta">25 – 26 Oct · in 10 days</p>
                    </div>
                    <Housemates size={26} />
                  </div>

                  <section
                    className={ready ? 'ld-ready is-done' : 'ld-ready'}
                    aria-label="Ready to go?"
                  >
                    {ready ? (
                      <p className="ld-ready-all">
                        <span className="ld-ready-mark" ref={mark}>
                          <Check weight="bold" aria-hidden="true" />
                        </span>
                        Ready to go
                      </p>
                    ) : (
                      <>
                        <div>
                          <p className="ld-plan-label">Ready to go?</p>
                          <ul className="ld-ready-list">
                            {lines.map((l) => (
                              <li key={l.key} className={l.ok ? 'is-ok' : 'is-todo'}>
                                {l.ok ? (
                                  <Check weight="bold" aria-label="Done" />
                                ) : (
                                  <Circle weight="bold" aria-label="Still to do" />
                                )}
                                <span>{l.text}</span>
                                {l.meta && <span className="ld-ready-meta">· {l.meta}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="ld-ready-side">
                          <p className="ld-plan-label">Packing</p>
                          <ul className="ld-ready-list">
                            <li className="is-todo">
                              <Circle weight="bold" aria-hidden="true" />
                              <span>0 of 4 packed</span>
                              <span className="ld-ready-link">Open list</span>
                            </li>
                          </ul>
                        </div>
                      </>
                    )}
                  </section>

                  <Pills tabs={['Plan', 'Bookings']} on={0} />
                  <div className="ld-plan-days" ref={days}>
                    {PLAN_DAYS.map((d) => (
                      <div key={d.key}>
                        <p className="ld-day">
                          <b>{d.label}</b> {d.where}
                        </p>
                        {plan.days[d.key].length === 0 ? (
                          <p className="ld-slot">Nothing planned yet</p>
                        ) : (
                          plan.days[d.key].map((s) => (
                            <div
                              key={s.id}
                              className={[
                                'ld-dayrow',
                                s.what === 'São Bento station' ? 'is-marked' : '',
                                s.fresh ? 'is-fresh' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <Box />
                              <span className="ld-time">{s.time}</span>
                              <span className="ld-dayrow-text">
                                <span className="ld-dayrow-what">{s.what}</span>
                                {s.place && <span className="ld-dayrow-place">{s.place}</span>}
                              </span>
                              <span className={`ld-pip is-${s.pip}`} />
                            </div>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                  <AddBarStill chip={target.label} placeholder="Add a place, plan or idea" />
                </section>

                <div className="ld-desk-map">
                  <PortoMap pins={pins} />
                  <span className="ld-map-chip is-day">Sat 25 · Sun 26</span>
                  <span className="ld-map-chips">
                    <span className="ld-map-chip">Show all days</span>
                    <span className="ld-map-chip">Fit day</span>
                  </span>
                  <span className="ld-map-zoom">
                    <Plus weight="bold" aria-hidden="true" />
                    <Minus weight="bold" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="device-stripe" />
        <div className="device-header" />
        <div className="device-sensors" />
        <div className="device-btns" />
        <div className="device-power" />
        <div className="device-home" />
        <p className="ld-sr" aria-live="polite">
          {said}
        </p>
      </div>
    </DeviceFit>
  )
}
