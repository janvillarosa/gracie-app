/// <reference types="vite/client" />

// Vite's client types declare the common asset modules (*.png, *.svg, *.ico,
// etc.). The web manifest is not among them, so declare it here.
declare module '*.webmanifest' {
  const src: string
  export default src
}

interface ImportMetaEnv {
  // The Protomaps hosted API key (empty: the map preview is used).
  readonly VITE_PROTOMAPS_API_KEY?: string
  // Glyph source for map labels (empty: no text labels on the map).
  readonly VITE_GLYPHS_URL?: string
  // Dev only: serve the trips API from the in-browser mock.
  readonly VITE_MOCK_TRIPS?: string
}
