import saoBento from '@assets/landing/sao-bento.jpg'
import station from '@assets/landing/santa-apolonia.jpg'
import type React from 'react'
import { useEffect, useId, useState } from 'react'
import { OfflineSlip } from './OfflineSlip'
import { PhoneTrip } from './PhoneTrip'
import { PlanDesk } from './PlanDesk'

// The trips part: one example trip, a weekend in Porto, in its two postures, switched with two
// pills. Planning at home is a laptop showing the app's desk (ideas, days, "Ready to go?" and the
// map). On the trip is a phone showing what's next and the booking's code, then the itinerary that
// keeps working with no signal. Each is the real interface drawn as the app draws it, with an
// example House's content. A photo is only here beside the line of the plan it shows, and that
// line carries the highlighter on screen.

type View = 'plan' | 'trip'

const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'plan', label: 'Planning at home' },
  { key: 'trip', label: 'On the trip' },
]

const PlanSheet: React.FC = () => (
  <div className="ld-capsheet is-blue is-device">
    <h3 className="ld-capsheet-name">Plan it on a laptop.</h3>
    <div className="ld-plan-intro">
      <p className="ld-capsheet-text">
        Ideas wait on the left until someone picks a day for them. Tap one and watch it land on the
        day and on the map. Up top, “Ready to go?” shows what the trip is still missing.
      </p>
      <figure className="ld-capsheet-photo">
        <img
          src={saoBento}
          width={900}
          height={600}
          alt="The hall of São Bento station in Porto, its walls covered in blue and white tiles under a yellow ceiling"
          loading="lazy"
          decoding="async"
        />
        <figcaption>São Bento station, the 11:00 stop on Saturday’s plan.</figcaption>
      </figure>
    </div>
    <div className="ld-device-stage" data-reveal>
      <PlanDesk />
    </div>
  </div>
)

const TripSheet: React.FC = () => (
  <div className="ld-capsheet is-red is-device">
    <h3 className="ld-capsheet-name">Run it from your phone.</h3>
    <div className="ld-trip-sheet">
      <div className="ld-trip-side">
        <figure className="ld-capsheet-photo">
          <img
            src={station}
            width={1000}
            height={656}
            alt="The platforms of Santa Apolónia station in Lisbon under its long roof"
            loading="lazy"
            decoding="async"
          />
          <figcaption>Santa Apolónia, where Saturday’s 09:09 to Porto leaves from.</figcaption>
        </figure>
        <p className="ld-capsheet-text">
          On the trip it’s the other way round: less planning, just what’s next. Whoever booked the
          train types it in once, code included. At the check-in desk anyone in the House can pull
          it up, instead of waiting on the one person with the email.
        </p>
      </div>
      <div className="ld-device-stage is-phone" data-reveal>
        <PhoneTrip />
      </div>
    </div>
  </div>
)

export const Capabilities: React.FC = () => {
  const base = useId()
  const [view, setView] = useState<View>('plan')
  // Without JavaScript (the page built ahead of time) both views are simply on the page.
  const [live, setLive] = useState(false)
  useEffect(() => setLive(true), [])

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length]
    setView(next.key)
    document.getElementById(`${base}-tab-${next.key}`)?.focus()
  }

  return (
    <section className="ld-trips" id="trips" aria-labelledby="ld-caps-h">
      <div className="ld-caps">
        <div className="ld-caps-intro">
          <h2 id="ld-caps-h" className="ld-h2" data-reveal>
            Plan the trip together.
          </h2>
          <p className="ld-body" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
            You plan trips with the same people you shop with, so it’s the same app. Plan it
            together at home, then run it from your phone. Packing is just another list, so two
            people don’t both bring the plug adapter.
          </p>
        </div>
        <div className="ld-views ld-pills" role="tablist" aria-label="Two ways to use a trip">
          {VIEWS.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`${base}-tab-${v.key}`}
              aria-selected={view === v.key}
              aria-controls={`${base}-panel-${v.key}`}
              tabIndex={view === v.key ? 0 : -1}
              className={view === v.key ? 'ld-pill is-on' : 'ld-pill'}
              onClick={() => setView(v.key)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${base}-panel-plan`}
          aria-labelledby={`${base}-tab-plan`}
          hidden={live && view !== 'plan'}
        >
          <PlanSheet />
        </div>
        <div
          role="tabpanel"
          id={`${base}-panel-trip`}
          aria-labelledby={`${base}-tab-trip`}
          hidden={live && view !== 'trip'}
        >
          <TripSheet />
        </div>
      </div>
      {/* The no-signal itinerary is a full-width band, so it sits outside the narrow column but
          belongs to the same view. */}
      <div hidden={live && view !== 'trip'}>
        <OfflineSlip />
      </div>
    </section>
  )
}
