import ribeira from '@assets/landing/ribeira.jpg'
import { Check, WifiSlash } from '@phosphor-icons/react'
import type React from 'react'
import { useReducer } from 'react'
import { Housemates } from './appUi'
import { initialSlip, SLIP_ROWS, slipReducer, slipStatus } from './demo'

/** The trips part's last beat, "On the trip, even with no signal": Saturday's itinerary as a slip.
 *  Turn on No signal and keep ticking; the changes wait on this phone and sync when the signal
 *  comes back, like the trip outbox. */
export const OfflineSlip: React.FC = () => {
  const [s, dispatch] = useReducer(slipReducer, undefined, initialSlip)
  const done = new Map(s.rows.map((r) => [r.id, r.done]))

  return (
    <div className="ld-offline">
      <div className="ld-offline-copy">
        <h3 className="ld-h2" data-reveal>
          On the trip, even with no signal.
        </h3>
        <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
          Your phone keeps its own copy of the trip. In a metro tunnel, or on a train with one bar
          of signal, you can still open a booking or tick off a stop. It all syncs once you’re back
          online.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={!s.online}
          className="ld-signal"
          onClick={() => dispatch({ type: 'signal', online: !s.online })}
          data-reveal
          style={{ '--i': 2 } as React.CSSProperties}
        >
          <span className="ld-signal-track" aria-hidden="true">
            <span className="ld-signal-thumb" />
          </span>
          <WifiSlash weight="bold" aria-hidden="true" />
          No signal
        </button>
        <p className="ld-offline-hint">
          Switch it on, tick a couple of stops, then switch it off again.
        </p>
      </div>

      <div className={s.online ? 'ld-slip' : 'ld-slip is-offline'} data-reveal>
        <figure className="ld-slip-plate">
          <span className="ld-slip-photo">
            <img
              src={ribeira}
              width={1000}
              height={667}
              alt="Rabelo boats on the Douro in front of the colourful houses of Ribeira, Porto"
              loading="lazy"
              decoding="async"
            />
          </span>
          <figcaption>Ribeira, where Saturday ends: dinner at 20:00.</figcaption>
        </figure>
        <div className="ld-slip-body" data-ui>
          <div className="ld-slip-head">
            <h3 className="ld-slip-title">Porto · Saturday</h3>
            <Housemates size={26} />
          </div>
          {SLIP_ROWS.map((g) => (
            <div key={g.heading} className="ld-slip-group">
              <h4 className="ld-slip-when">{g.heading}</h4>
              <ul>
                {g.rows.map((r) => {
                  const waiting = s.pending.includes(r.id)
                  return (
                    <li
                      key={r.id}
                      className={done.get(r.id) ? 'ld-slip-row is-done' : 'ld-slip-row'}
                    >
                      <label>
                        <input
                          type="checkbox"
                          className="ld-check-input"
                          checked={!!done.get(r.id)}
                          onChange={() => dispatch({ type: 'toggle', id: r.id })}
                        />
                        <span className="ld-box is-sm" aria-hidden="true">
                          <Check weight="bold" />
                        </span>
                        <span className="ld-slip-what">
                          {r.id === 's5' ? <span className="ld-mark">{r.what}</span> : r.what}
                          {waiting && <span className="ld-waiting">Waiting</span>}
                        </span>
                      </label>
                      <span className="ld-leader" aria-hidden="true" />
                      <span className="ld-time">{r.when}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        <p className="ld-slip-total" data-ui aria-live="polite">
          <span key={slipStatus(s)}>{slipStatus(s)}</span>
        </p>
        <svg className="ld-zigzag" aria-hidden="true" focusable="false" width="100%" height="14">
          <defs>
            <pattern id="ld-zz" width="16" height="14" patternUnits="userSpaceOnUse">
              <path d="M0 0 H16 L8 12 Z" />
            </pattern>
          </defs>
          <rect width="100%" height="14" fill="url(#ld-zz)" />
        </svg>
      </div>
    </div>
  )
}
