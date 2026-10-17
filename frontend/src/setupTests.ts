import 'fake-indexeddb/auto'
import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import { server, tripServer } from './testServer'
import { setPlacesSource } from './lib/trips/placesOverride'
import { resetPlaceInfo } from './lib/trips/places'

// The trips screens are heavy to mount; a slower machine should not turn that into a flake.
configure({ asyncUtilTimeout: 4000 })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  tripServer.trips.clear()
  setPlacesSource(null)
  resetPlaceInfo()
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

// jsdom runs every requestAnimationFrame callback off one setInterval, made when a frame is asked for
// with none pending and kept until none are. It takes setInterval from the global at that moment, so a
// frame asked for while a test fakes timers gets a fake interval; once real timers are back it never
// fires, and while that frame stays pending no new interval is made. From then on no frame runs, in
// this file or a later one (the single fork shares one window across files). Give each frame its own
// timer from whichever clock is current, so a faked clock can't outlive the test that faked it.
{
  const frames = new Map<number, () => void>()
  let lastFrame = 0
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = ++lastFrame
    const clear = globalThis.clearTimeout
    const timer = globalThis.setTimeout(() => {
      frames.delete(id)
      cb(performance.now())
    }, 1000 / 60)
    frames.set(id, () => clear(timer))
    return id
  }
  window.cancelAnimationFrame = (id: number) => {
    frames.get(id)?.()
    frames.delete(id)
  }
}
