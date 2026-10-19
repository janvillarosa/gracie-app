import { deletePushSubscription, getPushKey, putPushSubscription } from '@api/endpoints'
import type { PushSubscriptionBody } from '@api/types'
import { isAppleTouch } from '@lib/installPrompt'

// Web Push on this device. The service worker (public/sw.js) shows what the server sends, even
// with the app closed. Android Chrome can subscribe in a tab or installed; an iPhone or iPad only
// from the Home Screen app (iOS 16.4+), and only from a tap.
//
//   tap "Turn on" ─▶ requestPermission ─▶ GET /push/key ─▶ pushManager.subscribe ─▶ PUT
//   app start/login ─▶ resyncPush: the current subscription, PUT again (browsers rotate them)
//   sign out ─▶ disablePush: DELETE, then unsubscribe

/** Whether this device can turn notifications on: yes (`ok`), after adding Bauhouse to the Home
 *  Screen (`needs-install`, iOS in Safari), never in this browser (`unsupported`), or the person
 *  blocked them for this site (`denied`, only the browser's or system's settings can undo it). */
export type PushSupport = 'ok' | 'needs-install' | 'unsupported' | 'denied'

/** What a tap on "Turn on notifications" ended in. `dismissed`: the prompt was closed unanswered. */
export type EnableResult = 'on' | 'denied' | 'dismissed' | 'unsupported'

// The MSW mock owns the one service worker scope in mock mode; registering ours would replace it.
const MOCK = import.meta.env.VITE_MOCK_TRIPS === '1'
const SW_URL = '/sw.js'

function standalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function hasPushApis(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  // Safari on iPhone and iPad has no PushManager in a tab at all; the Home Screen app does.
  if (isAppleTouch(navigator.userAgent, navigator.maxTouchPoints ?? 0) && !standalone())
    return 'needs-install'
  if (!hasPushApis()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'ok'
}

/** Registers /sw.js (called once from main.tsx). Not in mock mode, where MSW's worker holds the
 *  scope. A failure only means no push on this device; the app works the same. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (MOCK || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' })
  } catch {
    return undefined
  }
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!hasPushApis()) return undefined
  return (await navigator.serviceWorker.getRegistration('/')) ?? registerServiceWorker()
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** The base64url VAPID key as the bytes `subscribe` wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

function body(sub: PushSubscription): PushSubscriptionBody {
  const json = sub.toJSON()
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    userAgent: navigator.userAgent,
  }
}

/** Whether this device is subscribed (the toggles show only then). */
export async function isPushOn(): Promise<boolean> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return false
  return (await currentSubscription()) !== null
}

/** Turns notifications on for this device. Call it straight from a tap: iOS only shows the
 *  permission prompt while the tap's user activation lasts, so the prompt is the first await. */
export async function enablePush(apiKey: string): Promise<EnableResult> {
  if (pushSupport() === 'needs-install' || !hasPushApis()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'dismissed'
  const reg = await registration()
  if (!reg) return 'unsupported'
  const key = keyBytes((await getPushKey(apiKey)).publicKey)
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with another server key can't receive this server's pushes.
  if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  await putPushSubscription(apiKey, body(sub))
  return 'on'
}

/** Turns notifications off for this device: the server forgets it, then the browser does. With no
 *  key (it was refused), only the browser's subscription goes; the server drops the dead endpoint
 *  on its next push. Never throws. */
export async function disablePush(apiKey: string | null): Promise<void> {
  try {
    const sub = await currentSubscription()
    if (!sub) return
    if (apiKey) await deletePushSubscription(apiKey, sub.endpoint).catch(() => undefined)
    await sub.unsubscribe()
  } catch {
    // Nothing to undo on this device.
  }
}

/** On app start and sign-in: hands the server this device's current subscription again, since
 *  browsers replace subscriptions now and then. Does nothing if it isn't on here. Never throws. */
export async function resyncPush(apiKey: string): Promise<void> {
  try {
    if (!hasPushApis() || Notification.permission !== 'granted') return
    const sub = await currentSubscription()
    if (sub) await putPushSubscription(apiKey, body(sub))
  } catch {
    // Offline or refused: the next start tries again.
  }
}
