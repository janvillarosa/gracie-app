// Where the Google map gets its key and Map ID. Neither is ever logged or rendered.
export type MapsConfig = {
  // VITE_GOOGLE_MAPS_API_KEY. Empty: the page draws the plain "Map preview" instead.
  key: string
  // VITE_GOOGLE_MAP_ID (the cloud style). DEMO_MAP_ID in dev only; advanced markers need one.
  mapId: string
}

export function mapsConfig(): MapsConfig {
  const key = ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim()
  const set = ((import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined) ?? '').trim()
  return { key, mapId: set || (import.meta.env.DEV ? 'DEMO_MAP_ID' : '') }
}

/** The real map needs both; otherwise the preview. */
export const mapsEnabled = (c: MapsConfig) => !!c.key && !!c.mapId

/** Never load Google while offline (the map pane is hidden then, but be sure). */
export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false
