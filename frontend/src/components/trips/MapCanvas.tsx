import React, { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from '@phosphor-icons/react'
import type { MapViewProps } from './mapView'
import type { MapsConfig } from './gmap/config'
import { MapController } from './gmap/controller'
import { loadGoogle } from './gmap/loader'
import './gmap/gmap.css'

type Props = MapViewProps & { config: MapsConfig; onFail: () => void }

declare global {
  interface Window {
    // Google calls this when the key is rejected (wrong referrer, API not enabled).
    gm_authFailure?: () => void
  }
}

/** The Google map: loaded on first show (never offline), then driven by a MapController. The
 *  page's own +/− sit bottom-right above Google's terms strip; the logo and terms are Google's
 *  and are never covered. */
const MapCanvas: React.FC<Props> = (props) => {
  const { config, onFail } = props
  const box = useRef<HTMLDivElement>(null)
  const ctl = useRef<MapController | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [ready, setReady] = useState(false)
  // The emphasised day is off the map (or its stops are piled up): the chip offers to show it.
  const [offMap, setOffMap] = useState(false)

  useEffect(() => {
    let dead = false
    const failed = () => {
      if (!dead) onFail()
    }
    window.gm_authFailure = failed
    loadGoogle(config)
      .then((google) => {
        if (dead || !box.current) return
        ctl.current = new MapController({
          google,
          container: box.current,
          config,
          props: latest.current,
          onReady: () => setReady(true),
          onOffMap: (off) => {
            if (!dead) setOffMap(off)
          },
        })
      })
      .catch(failed)
    return () => {
      dead = true
      if (window.gm_authFailure === failed) window.gm_authFailure = undefined
      ctl.current?.destroy()
      ctl.current = null
    }
  }, [config, onFail])

  // Every render hands the controller the latest props; it only does work for what changed.
  useEffect(() => {
    ctl.current?.sync(props)
  })

  return (
    <div
      className={
        props.interactive ? 'trip-map-gl-wrap gm-wrap' : 'trip-map-gl-wrap gm-wrap is-phone'
      }
    >
      <div ref={box} className="trip-map-gl gm-map" role="img" aria-label={props.title} />
      {!ready && <span className="map-label-badge">Loading map</span>}
      {offMap && props.onShowDay && (
        <div className="gm-chip">
          <span>{props.scene.emphasisLabel ?? 'That day'} is off the map</span>
          <span aria-hidden>·</span>
          <button type="button" onClick={props.onShowDay}>
            Show
          </button>
        </div>
      )}
      {props.interactive && (
        <div className="gm-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" onClick={() => ctl.current?.zoomBy(1)}>
            <Plus size={18} weight="bold" aria-hidden />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => ctl.current?.zoomBy(-1)}>
            <Minus size={18} weight="bold" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}

export default MapCanvas
