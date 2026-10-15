// A test hook kept apart from placesSource, so the test setup can reset it without loading Google.
import type { PlacesSource } from './placesSource'

let override: PlacesSource | null = null
export const setPlacesSource = (s: PlacesSource | null) => {
  override = s
}
export const placesOverride = () => override
