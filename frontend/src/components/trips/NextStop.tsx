import React, { useEffect, useRef, useState } from 'react'
import { Button, Card, Checkbox } from 'antd'
import type { Place } from '@api/tripTypes'
import { confettiAt } from '@lib/confetti'
import { mapsUrl } from '@lib/trips/schedule'
import { CodeReveal } from './CodeReveal'

export type Stop = {
  id: string
  kind: 'todo' | 'booking'
  // The todo's or booking's own title (for the checkbox and announcements).
  title: string
  // The heading is only where to go: the place name, else the title.
  heading: string
  // Muted, one line: the title when it differs, the time, the booking's descriptor, "Booked".
  sub: string
  time: string
  place?: Place | null
  notes?: string
  code?: string
  bookingKind?: import('@api/tripTypes').BookingKind
  line?: string
  // The booking this todo is linked to, if any: shown as "Booked", with its code behind a button.
  linked?: { title: string; kind: import('@api/tripTypes').BookingKind; line: string }
  done: boolean
  // A timed stop whose time has passed: the card says so gently.
  planned: boolean
}

export type Tomorrow = { date: string; label: string; first: string; time: string } | null

type Props = {
  stops: Stop[]
  tomorrow: Tomorrow
  locked: boolean
  onDone: (id: string) => void
  onSeeTomorrow: (date: string) => void
  onOpen: (id: string) => void
  onCopy: (code: string) => void
  announce: (text: string) => void
}

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const LEAVE_MS = 240

/** The next-stop deck: today's remaining stops as a stack of paper cards, the top one in full. */
export const NextStopDeck: React.FC<Props> = ({
  stops,
  tomorrow,
  locked,
  onDone,
  onSeeTomorrow,
  onOpen,
  onCopy,
  announce,
}) => {
  const open = stops.filter((s) => !s.done)
  const top = open[0]
  const [leaving, setLeaving] = useState(false)
  const [stamp, setStamp] = useState(false)
  const cardRef = useRef<HTMLElement>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    },
    [],
  )
  const dealt = useRef(false)
  const wasOpen = useRef(open.length)

  // After a deal, focus moves to the new top card and it is announced.
  useEffect(() => {
    if (!dealt.current) return
    dealt.current = false
    if (top) {
      // The heading takes focus (not the whole card), so the ring hugs the words.
      headRef.current?.focus({ preventScroll: true })
      announce(`Next stop: ${top.heading}${top.time ? `, ${top.time}` : ''}`)
    }
  }, [top, announce])

  // The last stop of the day: the stamp and a little confetti, once.
  useEffect(() => {
    if (wasOpen.current > 0 && open.length === 0 && stops.length > 0 && !reduced()) {
      setStamp(true)
      confettiAt(window.innerWidth / 2, 160, { count: 24, durationMs: 1400 })
      const t = setTimeout(() => setStamp(false), 1400)
      wasOpen.current = open.length
      return () => clearTimeout(t)
    }
    wasOpen.current = open.length
  }, [open.length, stops.length])

  const done = () => {
    if (!top || leaving) return
    const id = top.id
    if (!reduced()) {
      const r = cardRef.current?.getBoundingClientRect()
      if (r) confettiAt(r.left + 40, r.top + r.height * 0.3, { count: 12, durationMs: 900 })
    }
    dealt.current = true
    if (reduced()) return onDone(id)
    setLeaving(true)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => {
      setLeaving(false)
      onDone(id)
    }, LEAVE_MS)
  }

  const more = open.length - 1
  const pin = top?.place && top.place.source !== 'manual' ? top.place : null
  const note = top?.notes && top.notes.length <= 80 && !top.notes.includes('\n') ? top.notes : ''

  return (
    <div className={`trip-deck-wrap ${more >= 2 ? 'has-2' : more === 1 ? 'has-1' : ''}`}>
      <Card className="trip-deck" aria-label="Next stop" role="region">
        {top ? (
          <article
            ref={cardRef}
            key={top.id}
            className={leaving ? 'trip-deck-card is-leaving' : 'trip-deck-card'}
          >
            <p className="trip-kicker">Next stop</p>
            <div className="trip-deck-head">
              <span className="trip-check trip-deck-check">
                <Checkbox
                  checked={leaving}
                  disabled={locked}
                  onChange={done}
                  aria-label={`${top.title}, done`}
                />
              </span>
              <h3
                ref={headRef}
                tabIndex={-1}
                className={leaving ? 'trip-deck-title is-ticked' : 'trip-deck-title'}
              >
                <button
                  type="button"
                  className="trip-deck-titlebtn"
                  aria-haspopup="dialog"
                  onClick={() => onOpen(top.id)}
                >
                  {top.heading}
                </button>
              </h3>
            </div>
            <p className="trip-deck-sub">{top.sub}</p>
            {note && <p className="trip-deck-note">{note}</p>}
            {(pin || top.code) && (
              <div className="trip-deck-actions">
                {pin && (
                  <a
                    className="ant-btn ant-btn-primary ant-btn-round ant-btn-lg trip-go"
                    href={mapsUrl(pin.lat, pin.lng)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open Maps
                  </a>
                )}
                {top.code && (
                  <CodeReveal
                    code={top.code}
                    title={top.linked?.title ?? top.title}
                    kind={top.linked?.kind ?? top.bookingKind}
                    line={top.linked?.line ?? top.line}
                    onCopy={onCopy}
                  />
                )}
              </div>
            )}
          </article>
        ) : (
          <article ref={cardRef} className="trip-deck-card trip-deck-end">
            {stamp && <span className="trip-stamp">Day done</span>}
            <p className="trip-kicker">That’s today</p>
            <h3 ref={headRef} tabIndex={-1} className="trip-deck-title">
              {tomorrow ? `Tomorrow: ${tomorrow.label}` : 'Nothing planned for tomorrow yet'}
            </h3>
            {tomorrow?.first && (
              <p className="trip-deck-sub">
                First stop {tomorrow.first}
                {tomorrow.time ? ` at ${tomorrow.time}` : ''}
              </p>
            )}
            {tomorrow && (
              <div className="trip-deck-actions">
                <Button
                  type="primary"
                  shape="round"
                  size="large"
                  onClick={() => onSeeTomorrow(tomorrow.date)}
                >
                  See tomorrow
                </Button>
              </div>
            )}
          </article>
        )}
      </Card>
    </div>
  )
}
