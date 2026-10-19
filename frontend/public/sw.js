// Bauhouse service worker: push notifications only. It caches nothing, so the app loads from the
// network exactly as it does without it. Hand-written and served as-is from /sw.js (no build step),
// with Cache-Control: no-cache so a new version is picked up on the next visit (vercel.json).
//
// iOS revokes a subscription whose pushes show nothing, so every push shows a notification, even
// one whose payload can't be read.

const ICON = '/web-app-manifest-192x192.png'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Only a path on this site is opened: a payload can't send someone elsewhere.
function safePath(url) {
  if (typeof url !== 'string') return '/app'
  try {
    const u = new URL(url, self.location.origin)
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : '/app'
  } catch {
    return '/app'
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Bauhouse'
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: ICON,
    data: { url: safePath(data.url) },
  }
  // The same tag replaces the earlier notification instead of stacking another.
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = safePath(event.notification.data && event.notification.data.url)
  const target = new URL(path, self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((c) => new URL(c.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        if ('navigate' in open) {
          try {
            await open.navigate(target)
          } catch {
            // An uncontrolled client can't be navigated; it is focused all the same.
          }
        }
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
