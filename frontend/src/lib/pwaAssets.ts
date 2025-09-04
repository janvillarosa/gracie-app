// Injects favicon, apple-touch-icon, and a generated Web App Manifest at runtime.
// This allows us to keep assets under src/ and still have correct URLs post-build.

import appleTouch from '@assets/apple-touch-icon.png'
import faviconPng from '@assets/favicon-96x96.png'
import faviconIco from '@assets/favicon.ico'
import faviconSvg from '@assets/favicon.svg'
import icon192 from '@assets/web-app-manifest-192x192.png'
import icon512 from '@assets/web-app-manifest-512x512.png'
import manifestJson from '@assets/site.webmanifest'

const DEFAULT_THEME = '#FFD417'

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
  const base = (manifestJson || {}) as any
  const themeColor: string = base?.theme_color || DEFAULT_THEME

  // Favicons
  if (faviconSvg) upsertLink('icon-svg', 'icon', { type: 'image/svg+xml', href: faviconSvg })
  if (faviconPng) upsertLink('icon-png', 'icon', { type: 'image/png', sizes: '96x96', href: faviconPng })
  if (faviconIco) upsertLink('icon-ico', 'shortcut icon', { href: faviconIco })

  // Apple Touch Icon
  if (appleTouch) upsertLink('apple-touch-icon', 'apple-touch-icon', { sizes: '180x180', href: appleTouch })

  // theme colors
  upsertMeta('theme-color', themeColor)
  upsertMeta('apple-mobile-web-app-capable', 'yes')
  upsertMeta('apple-mobile-web-app-status-bar-style', 'default')

  // Manifest: start from the provided site.webmanifest and swap icon URLs
  const manifest = {
    ...base,
    // Ensure required properties from source are preserved
    theme_color: base?.theme_color ?? DEFAULT_THEME,
    background_color: base?.background_color ?? DEFAULT_THEME,
    display: base?.display ?? 'standalone',
    icons: [
      icon192 ? { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'maskable' } : undefined,
      icon512 ? { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' } : undefined,
    ].filter(Boolean),
  }

  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })
  const url = URL.createObjectURL(blob)
  upsertLink('pwa-manifest', 'manifest', { href: url, crossorigin: 'use-credentials' })
}
