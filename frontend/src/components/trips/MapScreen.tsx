import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui'
import { CaretLeft, CaretRight, X } from '@phosphor-icons/react'
import { mapsUrl } from '@lib/trips/schedule'
import type { MapScene } from '@lib/trips/mapScene'
import { TripMap } from './TripMap'

export type MapDay = { date: string; title: string; long: string }

type Props = {
  days: MapDay[]
  // The day to open on.
  initialDate: string
  // The stop that is selected when a day opens: the next stop during the trip, else the first.
  defaultSelected: (date: string, ids: string[]) => string | null
  scene: (date: string, selectedId: string | null) => MapScene
  // Tapping the card's text opens that item's detail.
  onOpenItem: (id: string) => void
  // A pill was tapped: the map closes and the list scrolls to that row and lights it.
  onShowRow?: (id: string) => void
  onClose: () => void
  // Focus returns here when the map closes.
  opener?: React.RefObject<HTMLElement | null>
}

/** The phone's map: full screen and read-only. A top bar (close, day stepper), the map, and one
 *  card for the stop you tapped. Back (the gesture or button) closes it: opening pushes a
 *  history entry. Mounted only while open, so nothing runs in the background. */
export const MapScreen: React.FC<Props> = ({
  days,
  initialDate,
  defaultSelected,
  scene,
  onOpenItem,
  onShowRow,
  onClose,
  opener,
}) => {
  const start = Math.max(
    0,
    days.findIndex((d) => d.date === initialDate),
  )
  const [index, setIndex] = useState(start)
  const day = days[index]
  const view = scene(day.date, null)
  const [selected, setSelected] = useState<string | null>(() =>
    defaultSelected(
      day.date,
      view.stops.map((s) => s.id),
    ),
  )
  const closeRef = useRef<HTMLButtonElement>(null)
  const swipe = useRef<number | null>(null)
  const closing = useRef(false)
  // The page re-renders while the map is open: its callbacks are read through a ref, so the
  // history entry is pushed once and not once per render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Back closes the map: one history entry while it is open, popped on the way out.
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    if (window.history.state?.tripMap) window.history.back()
    else onCloseRef.current()
  }, [])
  useEffect(() => {
    window.history.pushState(
      { ...(window.history.state ?? {}), tripMap: true },
      '',
      `${window.location.pathname}${window.location.search}#map`,
    )
    const onPop = () => {
      closing.current = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Leaving some other way (a route change): the entry stays, but it no longer says "map".
      if (!closing.current && window.history.state?.tripMap) {
        const { tripMap: _m, ...rest } = window.history.state
        window.history.replaceState(
          rest,
          '',
          `${window.location.pathname}${window.location.search}`,
        )
      }
    }
  }, [])

  // Focus starts on the close key and returns to what opened the map; Esc closes.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const target = opener?.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      target?.focus?.({ preventScroll: true })
    }
  }, [close, opener])

  // Tapping the card's text closes the map, then opens that item's sheet.
  const openItem = (id: string) => {
    close()
    onOpenItem(id)
  }

  const go = (i: number) => {
    const next = Math.min(days.length - 1, Math.max(0, i))
    if (next === index) return
    setIndex(next)
    const ids = scene(days[next].date, null).stops.map((s) => s.id)
    setSelected(defaultSelected(days[next].date, ids))
  }

  const shown = scene(day.date, selected)
  const stop = shown.stops.find((s) => s.id === selected)
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    if (stop) setAnnounce(`Selected ${stop.label}`)
  }, [stop])

  return (
    // biome-ignore lint/a11y/useSemanticElements: a full-screen view with its own history entry
    <div className="map-screen" role="dialog" aria-modal="true" aria-label={`Map for ${day.long}`}>
      <header
        className="map-screen-bar"
        onPointerDown={(e) => {
          swipe.current = e.clientY
        }}
        onPointerUp={(e) => {
          if (swipe.current !== null && e.clientY - swipe.current > 60) close()
          swipe.current = null
        }}
      >
        <Button
          kind="text"
          iconOnly
          ref={closeRef}
          className="map-screen-close"
          aria-label="Close map"
          icon={<X size={22} />}
          onClick={close}
        />
        <div className="map-screen-stepper">
          <Button
            kind="text"
            iconOnly
            aria-label="Previous day"
            disabled={index === 0}
            icon={<CaretLeft />}
            onClick={() => go(index - 1)}
          />
          <span className="map-screen-day">{day.title}</span>
          <Button
            kind="text"
            iconOnly
            aria-label="Next day"
            disabled={index === days.length - 1}
            icon={<CaretRight />}
            onClick={() => go(index + 1)}
          />
        </div>
        <span className="map-screen-balance" aria-hidden />
      </header>
      <div className="map-screen-map">
        <TripMap
          scene={shown}
          interactive={false}
          labelLimit={14}
          nextPrefix={false}
          onPinClick={(id) => {
            close()
            requestAnimationFrame(() => onShowRow?.(id))
          }}
          following
          fitToken={index}
          fitPadding={{ top: 56, bottom: 48, left: 40, right: 40 }}
          title={`Map of ${day.long}, ${shown.stops.length} ${shown.stops.length === 1 ? 'stop' : 'stops'}`}
        />
      </div>
      {stop ? (
        <section className="map-screen-card" aria-label="Selected stop">
          <button type="button" className="map-screen-text" onClick={() => openItem(stop.id)}>
            <span className="map-screen-name">{stop.label}</span>
            {stop.meta && <span className="map-screen-meta">{stop.meta}</span>}
          </button>
          <a
            className="ant-btn ant-btn-primary ant-btn-round ant-btn-lg trip-go"
            href={mapsUrl(stop.lat, stop.lng, stop.placeId)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open Maps
          </a>
        </section>
      ) : (
        <section className="map-screen-card is-empty" aria-label="Selected stop">
          <span className="map-screen-meta">Nothing with a place on this day.</span>
        </section>
      )}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  )
}
