import { setupServer } from 'msw/node'

// Shared MSW server for tests. Handlers are attached per-test.
export const server = setupServer()

