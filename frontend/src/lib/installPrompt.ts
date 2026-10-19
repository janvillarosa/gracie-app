import { useSyncExternalStore } from 'react'

// Installing Bauhouse to the home screen. Chrome, Edge and other Chromium browsers (Android and
// desktop) fire `beforeinstallprompt`, and the stored event can open their install dialog from a
// button. Safari on iPhone and iPad has no such API: there the only way is Share, then Add to Home
// Screen, so the page says that instead.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Adding Bauhouse to the Home Screen by hand, on an iPhone or iPad (Safari has no install API). */
export const IOS_INSTALL_STEPS = [
  'Tap Share in Safari’s toolbar.',
  'Choose Add to Home Screen.',
] as const

/** How this browser can put Bauhouse on the home screen: it already has (`installed`), from our
 *  button (`prompt`), by hand from Safari's Share menu (`ios`), or we can't tell (`browser`). */
export type InstallWay = 'installed' | 'prompt' | 'ios' | 'browser'

let deferred: InstallPromptEvent | null = null
let installed = false
const subscribers = new Set<() => void>()
const notify = () => {
  for (const fn of subscribers) fn()
}

/** Called once from main.tsx, before any page loads, so an early event isn't missed. The browser's
 *  own install hint is left alone (no preventDefault): the landing page only adds a button. */
export function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    notify()
  })
}

export function isAppleTouch(ua: string, maxTouchPoints: number): boolean {
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
}

export function installWay(): InstallWay {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (installed || standalone) return 'installed'
  if (deferred) return 'prompt'
  if (isAppleTouch(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return 'ios'
  return 'browser'
}

/** Opens the browser's install dialog; true when the visitor accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  // An install prompt can be shown once.
  deferred = null
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') installed = true
  notify()
  return outcome === 'accepted'
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

export function useInstallWay(): InstallWay {
  // At build time (the prerendered page) there's no browser to ask.
  return useSyncExternalStore(subscribe, installWay, () => 'browser')
}

/** Tests only: forget any stored event. */
export function resetInstallPrompt() {
  deferred = null
  installed = false
  notify()
}
