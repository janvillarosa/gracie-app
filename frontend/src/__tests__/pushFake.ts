import { vi } from 'vitest'

// A browser with Web Push, faked: Notification (permission and its prompt), PushManager on a
// service worker registration, and the user agent. `restore()` takes it all off the shared window.

export const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
export const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'

// The mock's VAPID key, as base64url and as the bytes it stands for.
export const PUBLIC_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

export type FakeSub = PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> }

export function fakeSubscription(endpoint: string, key: ArrayBuffer | null = null): FakeSub {
  const sub = {
    endpoint,
    options: { applicationServerKey: key, userVisibleOnly: true },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => {
      fake.subscription = null
      return true
    }),
  }
  return sub as unknown as FakeSub
}

type Options = {
  permission?: NotificationPermission
  // What the prompt answers.
  answer?: NotificationPermission
  subscription?: FakeSub | null
  ua?: string
  standalone?: boolean
  // No PushManager / serviceWorker at all (an old browser).
  noApis?: boolean
  // No registration yet: getRegistration resolves undefined.
  noRegistration?: boolean
}

export const fake = {
  permission: 'default' as NotificationPermission,
  subscription: null as FakeSub | null,
  requestPermission: vi.fn(),
  subscribe: vi.fn(),
  register: vi.fn(),
}

const touched: string[] = []

function define(target: object, prop: string, value: unknown) {
  Object.defineProperty(target, prop, { value, configurable: true, writable: true })
}

export function installPush(o: Options = {}) {
  fake.permission = o.permission ?? 'default'
  fake.subscription = o.subscription ?? null
  fake.requestPermission = vi.fn(async () => {
    fake.permission = o.answer ?? 'granted'
    return fake.permission
  })
  fake.subscribe = vi.fn(async (opts: PushSubscriptionOptionsInit) => {
    const key = opts.applicationServerKey as Uint8Array
    fake.subscription = fakeSubscription('https://push.example.com/new', key.slice().buffer)
    return fake.subscription
  })
  const pushManager = {
    getSubscription: async () => fake.subscription,
    subscribe: fake.subscribe,
  }
  const reg = { pushManager }
  fake.register = vi.fn(async () => reg)

  define(navigator, 'userAgent', o.ua ?? ANDROID)
  define(navigator, 'maxTouchPoints', (o.ua ?? ANDROID) === IPHONE ? 5 : 0)
  define(navigator, 'standalone', o.standalone ?? false)
  touched.push('userAgent', 'maxTouchPoints', 'standalone')
  if (o.noApis) return
  define(navigator, 'serviceWorker', {
    getRegistration: async () => (o.noRegistration ? undefined : reg),
    register: fake.register,
  })
  touched.push('serviceWorker')
  class FakeNotification {
    static get permission() {
      return fake.permission
    }
    static requestPermission = () => fake.requestPermission()
  }
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('PushManager', class {})
}

export function restorePush() {
  for (const p of touched.splice(0)) delete (navigator as unknown as Record<string, unknown>)[p]
  vi.unstubAllGlobals()
}
