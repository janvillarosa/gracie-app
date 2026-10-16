// Build step after `vite build` and `vite build --ssr src/landing.server.tsx`: writes the landing
// page's HTML and stylesheet into dist/index.html, so `/` has content without JavaScript.
//
// The markup sits in #prerender, beside #root (React never hydrates it). A tiny inline script
// drops it before first paint on any other route (every route is served this same file) and for
// signed-in members, who are sent on to /app. The landing page removes it when it mounts.
//
// SITE_URL (optional, e.g. https://bauhouse.app) makes og:url and og:image absolute, which
// link-preview scrapers prefer.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const ssrDir = path.join(root, 'dist-ssr')
const manifestPath = path.join(dist, '.vite', 'manifest.json')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

// Every stylesheet the landing page's chunk and its imports load.
function cssFor(key, seen = new Set()) {
  if (seen.has(key) || !manifest[key]) return []
  seen.add(key)
  const chunk = manifest[key]
  return [...(chunk.css ?? []), ...(chunk.imports ?? []).flatMap((k) => cssFor(k, seen))]
}
const entryCss = new Set(manifest['index.html']?.css ?? [])
const landingCss = [...new Set(cssFor('src/pages/Landing.tsx'))].filter((c) => !entryCss.has(c))
if (landingCss.length === 0) throw new Error('prerender: no stylesheet found for the landing page')

const server = path.join(ssrDir, 'landing.server.js')
const { renderLanding } = await import(pathToFileURL(server).href)
const html = renderLanding()
if (!html.includes('ld-h1')) throw new Error('prerender: the landing page rendered no headline')

const site = (process.env.SITE_URL ?? '').replace(/\/$/, '')
const indexPath = path.join(dist, 'index.html')
let index = fs.readFileSync(indexPath, 'utf8')

const links = landingCss.map((c) => `<link rel="stylesheet" href="/${c}" />`).join('\n    ')
index = index.replace('</head>', `  ${links}\n  </head>`)
// Root-relative preview URLs become absolute when the site's address is known.
if (site) index = index.replace(/(property="og:(?:url|image)" content=")\//g, `$1${site}/`)

const drop =
  "<script>(function(){var p=document.getElementById('prerender');var k=null;try{k=localStorage.getItem('gracie_api_key')}catch(e){}if(p&&(location.pathname!=='/'||k))p.remove()})()</script>"
index = index.replace(
  '<div id="root"></div>',
  `<div id="prerender">${html}</div>\n    ${drop}\n    <div id="root"></div>`,
)
fs.writeFileSync(indexPath, index)

// Neither the server bundle nor the manifest ships.
fs.rmSync(ssrDir, { recursive: true, force: true })
fs.rmSync(path.join(dist, '.vite'), { recursive: true, force: true })
console.log(
  `prerender: / is ${Math.round(html.length / 1024)} KB of HTML, ${landingCss.length} stylesheet(s)`,
)
