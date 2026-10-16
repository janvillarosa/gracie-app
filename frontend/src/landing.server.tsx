// Build-time only: renders the landing page to static HTML so search engines, link previews and
// visitors without JavaScript see the page. `scripts/prerender.mjs` puts the result into
// dist/index.html; the app replaces it once its own landing page has mounted.
import { Landing } from '@pages/Landing'
import { IconContext } from '@phosphor-icons/react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'

export function renderLanding(): string {
  return renderToString(
    <StaticRouter location="/">
      {/* The same icon defaults main.tsx gives the app. */}
      <IconContext.Provider
        value={{ weight: 'bold', size: '1em', color: 'currentColor', mirrored: false }}
      >
        <Landing />
      </IconContext.Provider>
    </StaticRouter>,
  )
}
