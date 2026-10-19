// Injects the favicons, apple-touch-icon and Apple web-app meta at runtime, so those assets can
// stay under src/ and still get hashed URLs. The Web App Manifest is a real file
// (public/manifest.webmanifest, linked from index.html): iOS reads an installed app's manifest
// from a stable URL, which a blob URL is not.

import appleTouch from '@assets/apple-touch-icon.png'
import faviconPng from '@assets/favicon-96x96.png'
import faviconIco from '@assets/favicon.ico'

function upsertLink(id: string, rel: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLLinkElement>(`link#${id}`)
  if (!el) {
    el = document.createElement('link')
    el.id = id
    el.rel = rel
    document.head.appendChild(el)
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
}

function upsertMeta(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export function setupPWAAssets() {
  if (typeof document === 'undefined') return
  // Favicons
  if (faviconPng)
    upsertLink('icon-png', 'icon', { type: 'image/png', sizes: '96x96', href: faviconPng })
  if (faviconIco) upsertLink('icon-ico', 'shortcut icon', { href: faviconIco })

  // Apple Touch Icon
  if (appleTouch)
    upsertLink('apple-touch-icon', 'apple-touch-icon', { sizes: '180x180', href: appleTouch })

  // theme-color is set in index.html (the desk tone, as in the manifest).
  upsertMeta('apple-mobile-web-app-capable', 'yes')
  upsertMeta('apple-mobile-web-app-status-bar-style', 'default')
}
