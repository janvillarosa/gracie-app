import { http } from 'msw'
import { server } from '../testServer'
import {
  disablePush,
  enablePush,
  isPushOn,
  keyBytes,
  pushSupport,
  registerServiceWorker,
  resyncPush,
} from '@lib/push'
import { fake, fakeSubscription, installPush, IPHONE, PUBLIC_KEY, restorePush } from './pushFake'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Call = { method: string; body: unknown; auth: string | null }

function serve() {
  const calls: Call[] = []
  const record = async (request: Request) => {
    calls.push({
      method: request.method,
      body: await request.json().catch(() => null),
      auth: request.headers.get('Authorization'),
    })
    return new Response(null, { status: 204 })
  }
  server.use(
    http.get('/api/push/key', () => json({ publicKey: PUBLIC_KEY })),
    http.put('/api/push/subscriptions', ({ request }) => record(request)),
    http.delete('/api/push/subscriptions', ({ request }) => record(request)),
  )
  return calls
}

afterEach(() => restorePush())

describe('pushSupport', () => {
  it('is ok where the browser has Web Push', () => {
    installPush()
    expect(pushSupport()).toBe('ok')
  })

  it('asks for the Home Screen first on an iPhone in Safari', () => {
    installPush({ ua: IPHONE })
    expect(pushSupport()).toBe('needs-install')
  })

  it('is ok in the iPhone Home Screen app', () => {
    installPush({ ua: IPHONE, standalone: true })
    expect(pushSupport()).toBe('ok')
  })

  it('is unsupported without the APIs', () => {
    installPush({ noApis: true })
    expect(pushSupport()).toBe('unsupported')
  })

  it('is denied once the person blocked notifications', () => {
    installPush({ permission: 'denied' })
    expect(pushSupport()).toBe('denied')
  })
})

describe('keyBytes', () => {
  it('decodes base64url to the 65-byte uncompressed point', () => {
    const b = keyBytes(PUBLIC_KEY)
    expect(b).toHaveLength(65)
    expect(b[0]).toBe(4)
  })
})

describe('enablePush', () => {
  it('asks first, subscribes with the server key and hands the subscription over', async () => {
    const calls = serve()
    installPush()
    expect(await enablePush('k1')).toBe('on')
    expect(fake.requestPermission).toHaveBeenCalledTimes(1)
    const opts = fake.subscribe.mock.calls[0][0] as PushSubscriptionOptionsInit
    expect(opts.userVisibleOnly).toBe(true)
    expect(Array.from(opts.applicationServerKey as Uint8Array)).toEqual(
      Array.from(keyBytes(PUBLIC_KEY)),
    )
    expect(calls).toEqual([
      {
        method: 'PUT',
        auth: 'Bearer k1',
        body: {
          endpoint: 'https://push.example.com/new',
          keys: { p256dh: 'p256-key', auth: 'auth-secret' },
          userAgent: navigator.userAgent,
        },
      },
    ])
    expect(await isPushOn()).toBe(true)
  })

  it('keeps a subscription made with the same key', async () => {
    const calls = serve()
    const same = fakeSubscription('https://push.example.com/kept', keyBytes(PUBLIC_KEY).buffer)
    installPush({ permission: 'granted', subscription: same })
    expect(await enablePush('k1')).toBe('on')
    expect(fake.subscribe).not.toHaveBeenCalled()
    expect((calls[0].body as { endpoint: string }).endpoint).toBe('https://push.example.com/kept')
  })

  it('replaces a subscription made with another key', async () => {
    serve()
    const old = fakeSubscription('https://push.example.com/old', new Uint8Array([1, 2]).buffer)
    installPush({ permission: 'granted', subscription: old })
    expect(await enablePush('k1')).toBe('on')
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(fake.subscribe).toHaveBeenCalled()
  })

  it('stops when the person says no, or closes the prompt', async () => {
    const calls = serve()
    installPush({ answer: 'denied' })
    expect(await enablePush('k1')).toBe('denied')
    restorePush()
    installPush({ answer: 'default' })
    expect(await enablePush('k1')).toBe('dismissed')
    expect(fake.subscribe).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('does not prompt on an iPhone outside the Home Screen app', async () => {
    installPush({ ua: IPHONE })
    expect(await enablePush('k1')).toBe('unsupported')
    expect(fake.requestPermission).not.toHaveBeenCalled()
  })

  it('registers the worker when none is there yet', async () => {
    serve()
    installPush({ noRegistration: true })
    expect(await enablePush('k1')).toBe('on')
    expect(fake.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('throws when the server refuses the subscription', async () => {
    server.use(
      http.get('/api/push/key', () => json({ publicKey: PUBLIC_KEY })),
      http.put('/api/push/subscriptions', () => json({ error: 'endpoint must be https' }, 400)),
    )
    installPush()
    await expect(enablePush('k1')).rejects.toThrow('endpoint must be https')
  })
})

describe('disablePush', () => {
  it('tells the server, then unsubscribes', async () => {
    const calls = serve()
    const sub = fakeSubscription('https://push.example.com/a')
    installPush({ permission: 'granted', subscription: sub })
    await disablePush('k1')
    expect(calls).toEqual([
      { method: 'DELETE', auth: 'Bearer k1', body: { endpoint: 'https://push.example.com/a' } },
    ])
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(await isPushOn()).toBe(false)
  })

  it('only unsubscribes when there is no key, or the server is unreachable', async () => {
    const calls = serve()
    const sub = fakeSubscription('https://push.example.com/a')
    installPush({ permission: 'granted', subscription: sub })
    await disablePush(null)
    expect(calls).toEqual([])
    expect(sub.unsubscribe).toHaveBeenCalled()

    server.use(http.delete('/api/push/subscriptions', () => json({ error: 'down' }, 503)))
    const again = fakeSubscription('https://push.example.com/b')
    installPush({ permission: 'granted', subscription: again })
    await disablePush('k1')
    expect(again.unsubscribe).toHaveBeenCalled()
  })

  it('does nothing without a subscription or without push', async () => {
    const calls = serve()
    installPush({ permission: 'granted' })
    await disablePush('k1')
    restorePush()
    installPush({ noApis: true })
    await expect(disablePush('k1')).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe('resyncPush', () => {
  it('hands the current subscription over again', async () => {
    const calls = serve()
    installPush({
      permission: 'granted',
      subscription: fakeSubscription('https://push.example.com/rotated'),
    })
    await resyncPush('k2')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      auth: 'Bearer k2',
      body: { endpoint: 'https://push.example.com/rotated' },
    })
  })

  it('does nothing when push is off here, and never throws', async () => {
    const calls = serve()
    installPush({ permission: 'default', subscription: fakeSubscription('https://p.example/x') })
    await resyncPush('k2')
    restorePush()
    installPush({ permission: 'granted' })
    await resyncPush('k2')
    expect(calls).toEqual([])

    server.use(http.put('/api/push/subscriptions', () => json({ error: 'down' }, 503)))
    restorePush()
    installPush({ permission: 'granted', subscription: fakeSubscription('https://p.example/y') })
    await expect(resyncPush('k2')).resolves.toBeUndefined()
  })
})

describe('registerServiceWorker', () => {
  it('registers /sw.js at the root scope', async () => {
    installPush()
    await registerServiceWorker()
    expect(fake.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('shrugs off a browser without workers, or one that refuses', async () => {
    installPush({ noApis: true })
    expect(await registerServiceWorker()).toBeUndefined()
    restorePush()
    installPush()
    fake.register.mockRejectedValueOnce(new Error('SecurityError'))
    expect(await registerServiceWorker()).toBeUndefined()
  })
})
