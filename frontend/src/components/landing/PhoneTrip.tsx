import { Avatar } from '@components/Avatar'
import {
  BatteryFull,
  Bed,
  CaretDown,
  CaretLeft,
  DotsThreeVertical,
  CellSignalFull,
  MapTrifold,
  Plus,
  WifiHigh,
} from '@phosphor-icons/react'
import type React from 'react'
import { useReducer, useRef } from 'react'
import { Box, Housemates, Pills } from './appUi'
import { confettiFrom } from './confetti'
import { DeviceFit } from './DeviceFit'
import { initialTrip, tripReducer } from './demo'

/** The on-the-trip view: the app on a phone during the trip. The next stop is one card with the
 *  place to go to, its time, and, for a booking, a button that opens its code (the code a counter
 *  asks for). Ticking it off brings the next stop up. Drawn from the app's phone screen; nothing
 *  leaves the browser. */
export const PhoneTrip: React.FC = () => {
  const [t, dispatch] = useReducer(tripReducer, undefined, initialTrip)
  const box = useRef<HTMLButtonElement>(null)
  const top = t.stops.find((s) => !s.done)
  const later = t.stops.filter((s) => !s.done && s !== top).slice(0, 3)

  const onDone = () => {
    if (!top) return
    confettiFrom(box.current)
    dispatch({ type: 'done', id: top.id })
  }

  return (
    <DeviceFit max={0.86}>
      <div className="device device-iphone-14-pro device-silver" data-ui>
        <div className="device-frame">
          <div className="device-screen ld-device-screen">
            <div className="ld-phone-screen">
              <div className="ld-phone-status" aria-hidden="true">
                <span>9:41</span>
                <span className="ld-phone-sys">
                  <CellSignalFull weight="fill" />
                  <WifiHigh weight="bold" />
                  <BatteryFull weight="fill" />
                </span>
              </div>
              <div className="ld-phone-top" aria-hidden="true">
                <span className="ld-phone-back">
                  <CaretLeft weight="bold" /> Our Little Mansion
                </span>
                <Avatar seed="Mia" size={34} alt="" />
              </div>

              <div className="ld-phone-stack">
                <div className="ld-phone-head">
                  <div className="ld-phone-head-row">
                    <span className="ld-app-icon" aria-hidden="true">
                      🧳 {/* taste-skill-ignore: the app’s own trip icon */}
                    </span>
                    <h4 className="ld-phone-title">Weekend in Porto</h4>
                    <DotsThreeVertical weight="bold" className="ld-phone-more" aria-hidden="true" />
                  </div>
                  <div className="ld-phone-head-row is-meta">
                    <span className="ld-phone-day">
                      Day 1 of 2 · Sat 25 <CaretDown weight="bold" aria-hidden="true" />
                    </span>
                    <Housemates size={26} />
                  </div>
                </div>

                <div className="ld-phone-sheet">
                  <div className="ld-phone-tabs">
                    <Pills tabs={['Plan', 'Ideas', 'Bookings']} on={0} />
                    <span className="ld-phone-map" aria-hidden="true">
                      <MapTrifold weight="bold" /> Map
                    </span>
                  </div>

                  <div
                    className={
                      later.length >= 2
                        ? 'ld-next-wrap has-2'
                        : later.length === 1
                          ? 'ld-next-wrap has-1'
                          : 'ld-next-wrap'
                    }
                  >
                    {top ? (
                      <section className="ld-next" aria-label="Next stop">
                        <p className="ld-kicker">Next stop</p>
                        <div className="ld-next-row">
                          <button
                            type="button"
                            ref={box}
                            className="ld-next-check"
                            aria-label={`Tick off ${top.title}`}
                            onClick={onDone}
                          >
                            <Box />
                          </button>
                          <h4
                            className={top.id === 't1' ? 'ld-next-title ld-mark' : 'ld-next-title'}
                          >
                            {top.heading}
                          </h4>
                        </div>
                        <p className="ld-next-sub">{top.sub}</p>
                        <div className="ld-next-actions">
                          <span className="ld-next-maps" aria-hidden="true">
                            Open Maps
                          </span>
                          {top.code && (
                            <button
                              type="button"
                              className="ld-next-code"
                              aria-expanded={t.shown === top.id}
                              onClick={() => dispatch({ type: 'code', id: top.id })}
                            >
                              {t.shown === top.id ? (
                                <b className="ld-code">{top.code}</b>
                              ) : (
                                'Show code'
                              )}
                            </button>
                          )}
                        </div>
                      </section>
                    ) : (
                      <section className="ld-next is-done" aria-label="Next stop">
                        <p className="ld-kicker">That’s today</p>
                        <p className="ld-next-sub">Tomorrow: Livraria Lello at 10:30.</p>
                      </section>
                    )}
                  </div>

                  <p className="ld-later">
                    <span>
                      <b>Later today</b> Porto
                    </span>
                    <CaretDown weight="bold" aria-hidden="true" />
                  </p>
                  <div className="ld-dayrow is-stay">
                    <Bed weight="bold" aria-hidden="true" />
                    <span className="ld-time">Tonight</span>
                    <span className="ld-dayrow-text">
                      <span className="ld-dayrow-what">The flat in Ribeira</span>
                    </span>
                    <span />
                  </div>
                  {later.map((s) => (
                    <div key={s.id} className="ld-dayrow">
                      <Box />
                      <span className="ld-time">{s.time}</span>
                      <span className="ld-dayrow-text">
                        <span className="ld-dayrow-what">{s.title}</span>
                      </span>
                      <span className={`ld-pip is-${s.pip}`} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="ld-addbar is-still ld-phone-add" aria-hidden="true">
                <span className="ld-addbar-field">
                  <span className="ld-addbar-chip">Today</span>
                  <span className="ld-addbar-placeholder">Add to today</span>
                </span>
                <span className="ld-addbar-btn is-armed">
                  <Plus weight="bold" />
                </span>
              </div>
              <span className="ld-phone-home" aria-hidden="true" />
            </div>
          </div>
        </div>
        <div className="device-stripe" />
        <div className="device-header" />
        <div className="device-sensors" />
        <div className="device-btns" />
        <div className="device-power" />
        <div className="device-home" />
      </div>
    </DeviceFit>
  )
}
