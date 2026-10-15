/// <reference types="vite/client" />
/// <reference types="google.maps" />

// Vite's client types declare the common asset modules (*.png, *.svg, *.ico,
// etc.). The web manifest is not among them, so declare it here.
declare module '*.webmanifest' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  // Google Maps Platform browser key, restricted by HTTP referrer (empty: the map preview is used).
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  // The cloud-styled Map ID (DEMO_MAP_ID is used in dev when empty).
  readonly VITE_GOOGLE_MAP_ID?: string
  // Dev only: serve the trips API from the in-browser mock.
  readonly VITE_MOCK_TRIPS?: string
}
