import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './testServer'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
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
