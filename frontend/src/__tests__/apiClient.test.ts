import { server } from '../testServer'
import { http } from 'msw'
import { apiFetch } from '@api/client'

describe('apiFetch', () => {
  it('sends Authorization header when apiKey provided', async () => {
    let auth = ''
    server.use(
      http.get('/api/ping', ({ request }) => {
        auth = request.headers.get('authorization') || ''
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })
    )
    await apiFetch<{ ok: boolean }>('/ping', { apiKey: 'k_abc' })
    expect(auth).toBe('Bearer k_abc')
  })

  it('throws ApiError with message and status on JSON error', async () => {
    server.use(
      http.get('/api/fail', () => new Response(JSON.stringify({ error: 'nope' }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
    )
    await expect(apiFetch('/fail')).rejects.toMatchObject({ message: 'nope', status: 403 })
  })
})

