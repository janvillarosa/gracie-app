import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import { server, tripServer } from './testServer'
import { setPlacesSource } from './lib/trips/placesSource'
import { resetPlaceInfo } from './lib/trips/places'
import { resetPlaceMaintenance } from './lib/trips/usePlaces'

// The trips screens are heavy to mount; a slower machine should not turn that into a flake.
configure({ asyncUtilTimeout: 4000 })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  tripServer.trips.clear()
  setPlacesSource(null)
  resetPlaceInfo()
  resetPlaceMaintenance()
  cleanup()
  // Registered first, so it runs last: a test that froze the clock never leaks it to the next file.
  vi.useRealTimers()
})
afterAll(() => server.close())

// Polyfills for jsdom
// Always override to ensure libraries like antd can call it safely at import time
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Minimal getComputedStyle used by antd portals/scrollbar measurement
Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: () => ({ getPropertyValue: () => '' }) as any,
})
