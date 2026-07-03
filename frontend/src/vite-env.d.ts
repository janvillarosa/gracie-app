/// <reference types="vite/client" />

// Vite's client types declare the common asset modules (*.png, *.svg, *.ico,
// etc.). The web manifest is not among them, so declare it here.
declare module '*.webmanifest' {
  const src: string
  export default src
}
