import { http } from 'msw'
import { server } from '../testServer'
import * as api from '@api/endpoints'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Registers a handler for `method path` that records the request (auth header +
// parsed JSON body) and replies with `reply`. Returns a getter for what was seen.
function capture(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  reply: unknown = {},
) {
  const seen: { auth: string | null; body: unknown; url: string } = {
    auth: null,
    body: undefined,
    url: '',
  }
  server.use(
    http[method](path, async ({ request }) => {
      seen.auth = request.headers.get('authorization')
      seen.url = request.url
      try {
        seen.body = await request.json()
      } catch {
        seen.body = undefined
      }
      return json(reply)
    }),
  )
  return seen
}

const KEY = 'k_test'

describe('endpoints — users & auth', () => {
  it('registerUser POSTs name to /users', async () => {
    const seen = capture('post', '/api/users', { user: { user_id: 'u1' }, api_key: 'k1' })
    const res = await api.registerUser('Ada')
    expect(seen.body).toEqual({ name: 'Ada' })
    expect(res.api_key).toBe('k1')
  })

  it('registerAuth POSTs credentials to /auth/register', async () => {
    const seen = capture('post', '/api/auth/register')
    await api.registerAuth('a@b.com', 'pw', 'Ada')
    expect(seen.body).toEqual({ username: 'a@b.com', password: 'pw', name: 'Ada' })
  })

  it('loginAuth returns user + api_key', async () => {
    capture('post', '/api/auth/login', { user: { user_id: 'u1' }, api_key: 'k2' })
    const res = await api.loginAuth('a@b.com', 'pw')
    expect(res.api_key).toBe('k2')
  })

  it('getMe sends the bearer token', async () => {
    const seen = capture('get', '/api/me', { user_id: 'u1' })
    await api.getMe(KEY)
    expect(seen.auth).toBe(`Bearer ${KEY}`)
  })

  it('updateMe PUTs the new name', async () => {
    const seen = capture('put', '/api/me', { user_id: 'u1', name: 'New' })
    await api.updateMe(KEY, 'New')
    expect(seen.body).toEqual({ name: 'New' })
  })

  it('updateMyProfile PATCHes partial params', async () => {
    const seen = capture('patch', '/api/me')
    await api.updateMyProfile(KEY, { username: 'x@y.com' })
    expect(seen.body).toEqual({ username: 'x@y.com' })
  })

  it('changeMyPassword POSTs to /me/password and returns rotated key', async () => {
    const seen = capture('post', '/api/me/password', { api_key: 'rotated' })
    const res = await api.changeMyPassword(KEY, { current_password: 'old', new_password: 'new' })
    expect(seen.body).toEqual({ current_password: 'old', new_password: 'new' })
    expect(res.api_key).toBe('rotated')
  })

  it('deleteMyAccount DELETEs /me with confirm', async () => {
    const seen = capture('delete', '/api/me')
    await api.deleteMyAccount(KEY)
    expect(seen.body).toEqual({ confirm: 'DELETE' })
  })
})

describe('endpoints — rooms', () => {
  it('getMyRoom GETs /rooms/me', async () => {
    const seen = capture('get', '/api/rooms/me', { display_name: 'Home' })
    const res = await api.getMyRoom(KEY)
    expect(seen.auth).toBe(`Bearer ${KEY}`)
    expect(res.display_name).toBe('Home')
  })

  it('createRoom POSTs /rooms', async () => {
    capture('post', '/api/rooms', { display_name: 'Solo' })
    const res = await api.createRoom(KEY)
    expect(res.display_name).toBe('Solo')
  })

  it('rotateShare returns a token', async () => {
    capture('post', '/api/rooms/share', { token: 'ABCDE' })
    const res = await api.rotateShare(KEY)
    expect(res.token).toBe('ABCDE')
  })

  it('joinRoomByToken POSTs the token', async () => {
    const seen = capture('post', '/api/rooms/join', { display_name: 'Joined' })
    await api.joinRoomByToken(KEY, 'ABCDE')
    expect(seen.body).toEqual({ token: 'ABCDE' })
  })

  it('voteDeletion returns deleted flag', async () => {
    capture('post', '/api/rooms/deletion/vote', { deleted: true })
    const res = await api.voteDeletion(KEY)
    expect(res.deleted).toBe(true)
  })

  it('cancelDeletion POSTs cancel', async () => {
    const seen = capture('post', '/api/rooms/deletion/cancel')
    await api.cancelDeletion(KEY)
    expect(seen.auth).toBe(`Bearer ${KEY}`)
  })

  it('updateRoomSettings PUTs settings', async () => {
    const seen = capture('put', '/api/rooms/settings', { display_name: 'Renamed' })
    await api.updateRoomSettings(KEY, { display_name: 'Renamed' })
    expect(seen.body).toEqual({ display_name: 'Renamed' })
  })

  it('getRoomPantry GETs the room pantry by id', async () => {
    const seen = capture('get', '/api/rooms/r1/pantry', [])
    await api.getRoomPantry(KEY, 'r1')
    expect(seen.url).toContain('/rooms/r1/pantry')
  })
})

describe('endpoints — lists & items', () => {
  it('getLists GETs room lists', async () => {
    const seen = capture('get', '/api/rooms/r1/lists', [])
    await api.getLists(KEY, 'r1')
    expect(seen.url).toContain('/rooms/r1/lists')
  })

  it('createList POSTs list params', async () => {
    const seen = capture('post', '/api/rooms/r1/lists', { list_id: 'l1' })
    await api.createList(KEY, 'r1', { name: 'Groceries', icon: 'APPLE' })
    expect(seen.body).toEqual({ name: 'Groceries', icon: 'APPLE' })
  })

  it('updateList PATCHes list params', async () => {
    const seen = capture('patch', '/api/rooms/r1/lists/l1', { list_id: 'l1' })
    await api.updateList(KEY, 'r1', 'l1', { notes: 'hi' })
    expect(seen.body).toEqual({ notes: 'hi' })
  })

  it('voteListDeletion returns deleted flag', async () => {
    capture('post', '/api/rooms/r1/lists/l1/deletion/vote', { deleted: false })
    const res = await api.voteListDeletion(KEY, 'r1', 'l1')
    expect(res.deleted).toBe(false)
  })

  it('cancelListDeletion POSTs cancel', async () => {
    const seen = capture('post', '/api/rooms/r1/lists/l1/deletion/cancel')
    await api.cancelListDeletion(KEY, 'r1', 'l1')
    expect(seen.auth).toBe(`Bearer ${KEY}`)
  })

  it('clearListItems POSTs clear', async () => {
    const seen = capture('post', '/api/rooms/r1/lists/l1/clear')
    await api.clearListItems(KEY, 'r1', 'l1')
    expect(seen.url).toContain('/lists/l1/clear')
  })

  it('getListItems sets include_completed=false by default and true when asked', async () => {
    const a = capture('get', '/api/rooms/r1/lists/l1/items', [])
    await api.getListItems(KEY, 'r1', 'l1')
    expect(a.url).toContain('include_completed=false')

    const b = capture('get', '/api/rooms/r1/lists/l1/items', [])
    await api.getListItems(KEY, 'r1', 'l1', true)
    expect(b.url).toContain('include_completed=true')
  })

  it('createListItem POSTs item params', async () => {
    const seen = capture('post', '/api/rooms/r1/lists/l1/items', { item_id: 'i1' })
    await api.createListItem(KEY, 'r1', 'l1', { description: 'Milk', quantity: '2' })
    expect(seen.body).toEqual({ description: 'Milk', quantity: '2' })
  })

  it('updateListItem PATCHes item fields', async () => {
    const seen = capture('patch', '/api/rooms/r1/lists/l1/items/i1', { item_id: 'i1' })
    await api.updateListItem(KEY, 'r1', 'l1', 'i1', { completed: true })
    expect(seen.body).toEqual({ completed: true })
  })

  it('deleteListItem DELETEs the item', async () => {
    const seen = capture('delete', '/api/rooms/r1/lists/l1/items/i1')
    await api.deleteListItem(KEY, 'r1', 'l1', 'i1')
    expect(seen.url).toContain('/items/i1')
  })

  it('reorderListItem PATCHes the position endpoint', async () => {
    const seen = capture('patch', '/api/rooms/r1/lists/l1/items/i1/position', { item_id: 'i1' })
    await api.reorderListItem(KEY, 'r1', 'l1', 'i1', { prev_id: 'i0' })
    expect(seen.body).toEqual({ prev_id: 'i0' })
    expect(seen.url).toContain('/position')
  })
})

describe('endpoints — error predicates', () => {
  it('isNotFound / isForbidden / isConflict match on status', () => {
    expect(api.isNotFound({ status: 404 })).toBe(true)
    expect(api.isNotFound({ status: 403 })).toBe(false)
    expect(api.isForbidden({ status: 403 })).toBe(true)
    expect(api.isConflict({ status: 409 })).toBe(true)
    expect(api.isConflict({ status: 200 })).toBe(false)
  })

  it('predicates are false for non-objects', () => {
    expect(api.isNotFound(null)).toBe(false)
    expect(api.isForbidden('nope')).toBe(false)
    expect(api.isConflict(undefined)).toBe(false)
  })
})

describe('test mode endpoints', () => {
  it('lists actions and runs one by id', async () => {
    const seen: string[] = []
    server.use(
      http.get('/api/test/actions', () => Response.json({ actions: [] })),
      http.post('/api/test/actions/:id', ({ params, request }) => {
        seen.push(`${request.method} ${params.id}`)
        return Response.json({ message: 'ok' })
      }),
    )
    const { listTestActions, runTestAction } = await import('@api/endpoints')
    expect(await listTestActions('k')).toEqual({ actions: [] })
    expect(await runTestAction('k', 'push.test')).toEqual({ message: 'ok' })
    expect(seen).toEqual(['POST push.test'])
  })
})
