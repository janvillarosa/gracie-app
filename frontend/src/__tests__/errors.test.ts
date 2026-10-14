import { errorMessage, OFFLINE_MESSAGE } from '@lib/errors'

const fallback = 'Couldn’t save your changes. Try again.'
const withStatus = (message: string, status?: number) =>
  Object.assign(new Error(message), { status })

describe('errorMessage', () => {
  it('replaces bare server tokens with the caller’s recovery message', () => {
    for (const token of ['bad request', 'conflict', 'forbidden', 'not found', 'Unauthorized?']) {
      const shown = errorMessage(withStatus(token, 400), fallback)
      // "Unauthorized?" is a real sentence-ish message, so only the bare tokens collapse.
      if (token !== 'Unauthorized?') expect(shown).toBe(fallback)
    }
  })

  it('keeps a real sentence from the server', () => {
    expect(errorMessage(withStatus('Name already taken', 409), fallback)).toBe('Name already taken')
  })

  it('tells people their session expired on 401', () => {
    expect(errorMessage(withStatus('unauthorized', 401), fallback)).toMatch(/session expired/i)
  })

  it('treats server failures and network errors as a connection problem', () => {
    expect(errorMessage(withStatus('boom', 503), fallback)).toBe(OFFLINE_MESSAGE)
    expect(errorMessage(new TypeError('Failed to fetch'), fallback)).toBe(OFFLINE_MESSAGE)
  })

  it('falls back when there is no message at all', () => {
    expect(errorMessage(undefined, fallback)).toBe(fallback)
    expect(errorMessage(withStatus('', 400), fallback)).toBe(fallback)
  })
})
