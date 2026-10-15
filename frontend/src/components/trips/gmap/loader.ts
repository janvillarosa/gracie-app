import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { isOnline, mapsConfig, type MapsConfig } from './config'

export type Google = {
  maps: google.maps.MapsLibrary
  marker: google.maps.MarkerLibrary
  core: google.maps.CoreLibrary
}

let configured = false
let pending: Promise<Google> | null = null

/** Loads the Maps JavaScript API on first use, from maps.googleapis.com only. Never offline.
 *  The key goes to the loader and nowhere else: it is not logged, stored or rendered. */
function configure(config: MapsConfig) {
  if (configured) return
  setOptions({ key: config.key, v: 'weekly' })
  configured = true
}

export function loadGoogle(config: MapsConfig): Promise<Google> {
  if (!isOnline()) return Promise.reject(new Error('offline'))
  if (!pending) {
    configure(config)
    const p = Promise.all([importLibrary('maps'), importLibrary('marker'), importLibrary('core')])
      .then(([maps, marker, core]) => ({ maps, marker, core }))
      .catch((e) => {
        // A failed load can be retried by the next mount.
        pending = null
        throw e
      })
    pending = p
  }
  return pending
}

/** The places library loads on the first place tap or search, not with the map. */
export function loadPlaces(config: MapsConfig = mapsConfig()) {
  if (!isOnline()) return Promise.reject(new Error('offline'))
  configure(config)
  return importLibrary('places')
}
/** Test hook: forget a loaded API. */
export function resetGoogleLoader() {
  pending = null
  configured = false
}
