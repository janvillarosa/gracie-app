import type React from 'react'
import { useMemo } from 'react'
import type { Trip } from '@api/tripTypes'
import { PrintOnly, PrintSheet } from '@components/ui'
import { buildItinerary } from '@lib/trips/itinerary'
import { fullDay, localDateKey } from '@lib/trips/schedule'

type Props = { trip: Trip; preparedBy?: string; house?: string }

const Cell: React.FC<{ main: string; sub?: string }> = ({ main, sub }) => (
  <>
    {main}
    {sub && <span className="print-sub">{sub}</span>}
  </>
)

const TripPaper: React.FC<Props> = ({ trip, preparedBy, house }) => {
  const doc = useMemo(
    () => buildItinerary(trip, { today: localDateKey(), preparedBy, house }),
    [trip, preparedBy, house],
  )
  // A Route column with nothing in it would only squeeze the others.
  const hasRoute = doc.transport.some((r) => r.route)
  return (
    <PrintSheet kicker="Travel itinerary" title={trip.title} facts={doc.facts}>
      {doc.transport.length > 0 && (
        <section className="print-section">
          <h2 className="print-section-title">Transport</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">Departs</th>
                <th scope="col">Arrives</th>
                <th scope="col">Booking</th>
                {hasRoute && <th scope="col">Route</th>}
              </tr>
            </thead>
            <tbody>
              {doc.transport.map((r) => (
                <tr key={r.id}>
                  <td>{r.departs}</td>
                  <td>{r.arrives}</td>
                  <td>
                    <Cell main={r.name} sub={r.kind} />
                  </td>
                  {hasRoute && <td>{r.route}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {doc.stays.length > 0 && (
        <section className="print-section">
          <h2 className="print-section-title">Accommodation</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">Property</th>
                <th scope="col">Location</th>
                <th scope="col">Check-in</th>
                <th scope="col">Check-out</th>
                <th scope="col" className="is-num">
                  Nights
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.stays.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.where}</td>
                  <td>{r.checkIn}</td>
                  <td>{r.checkOut}</td>
                  <td className="is-num">{r.nights}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {doc.other.length > 0 && (
        <section className="print-section">
          <h2 className="print-section-title">Tickets and other bookings</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Booking</th>
                <th scope="col">Location</th>
              </tr>
            </thead>
            <tbody>
              {doc.other.map((r) => (
                <tr key={r.id}>
                  <td>{r.when}</td>
                  <td>
                    <Cell main={r.name} sub={r.kind} />
                  </td>
                  <td>{r.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {doc.days.length > 0 && (
        <section className="print-section">
          <h2 className="print-section-title">Day-by-day itinerary</h2>
          {doc.days.map((d) => (
            <div key={d.date} className="print-day">
              <h3 className="print-day-title">
                Day {d.n}
                <span className="print-day-date"> · {fullDay(d.date)}</span>
                {d.label && <span className="print-day-label"> · {d.label}</span>}
              </h3>
              {d.rows.length === 0 ? (
                <p className="print-empty">Nothing planned</p>
              ) : (
                <table className="print-table is-plan">
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <th scope="row" className="print-time">
                          {r.time}
                        </th>
                        <td>
                          <Cell main={r.what} sub={r.where} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </section>
      )}
      <p className="print-note">All times are local to the place they refer to.</p>
    </PrintSheet>
  )
}

/** A trip as a formal itinerary: summary, transport, accommodation and the plan day by day. Handy
 *  for a visa appointment. Confirmation codes and notes stay in the app. */
export const TripPrint: React.FC<Props> = (props) => (
  <PrintOnly>
    <TripPaper {...props} />
  </PrintOnly>
)
