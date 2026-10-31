// The design system lives in one token block (frontend/src/styles.css) and one reference page
// (docs/design-system/index.html). These keep them honest: the page shows the real values, and
// the app's CSS draws only with tokens.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const ROOT = join(SRC, '..', '..')
const read = (p: string) => readFileSync(p, 'utf8')

const tokenBlock = (css: string) => {
  const m = css.match(/\/\* =+\s*\n\s*Design tokens:[\s\S]*?\n:root \{[\s\S]*?\n\}\n/)
  return m ? m[0] : null
}
/** A stylesheet without its token block, other :root blocks and comments. */
const outsideTokens = (css: string) =>
  css
    .replace(tokenBlock(css) ?? '', '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/:root\s*\{[^}]*\}/g, '')

// The app's own stylesheets. The landing page keeps its own poster scale (DESIGN.md, Landing).
const APP_CSS = [
  'styles.css',
  'trips.css',
  'desk.css',
  'components/ui/ui.css',
  'components/trips/gmap/gmap.css',
]

describe('the design tokens', () => {
  const styles = read(join(SRC, 'styles.css'))
  const block = tokenBlock(styles)

  it('live in one block at the top of styles.css', () => {
    expect(block).not.toBeNull()
    expect(styles.match(/^:root \{/gm)).toHaveLength(1)
  })

  it('are shown, unchanged, on the reference page (run `pnpm design:sync` after changing one)', () => {
    const page = read(join(ROOT, 'docs', 'design-system', 'index.html'))
    const pageBlock = page.match(
      /<style id="design-tokens">\n([\s\S]*?)<\/style><!-- \/design-tokens -->/,
    )
    expect(pageBlock?.[1]).toBe(block)
  })

  it('include the type roles, weights, inks, controls, corners and paper heights', () => {
    for (const name of [
      '--t-display',
      '--t-title',
      '--t-heading',
      '--t-lead',
      '--t-field',
      '--t-body',
      '--t-meta',
      '--t-label',
      '--t-stamp',
      '--t-code',
      '--w-regular',
      '--w-medium',
      '--w-semibold',
      '--w-bold',
      '--ink',
      '--text',
      '--muted',
      '--bg',
      '--panel',
      '--panel-subtle',
      '--border',
      '--border-strong',
      '--control-sm',
      '--control-md',
      '--control-lg',
      '--radius-xs',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--lift-0',
      '--lift-1',
      '--lift-2',
      '--lift-3',
      '--grain-paper',
      '--grain-desk',
    ])
      expect(block).toContain(`${name}:`)
  })

  it('retired names stay retired', () => {
    for (const name of [
      '--ink-heading',
      '--text-secondary',
      '--color-primary',
      '--size-meta',
      '--radius-squircle',
      '--control-h',
    ])
      expect(block).not.toContain(`${name}:`)
  })
})

describe('the stylesheets are well formed', () => {
  // A torn comment (an opener whose */ went missing) silently swallows every rule up to the next
  // one: the page loses its layout with no error. Every /* closes before the next /* opens.
  for (const file of [...APP_CSS, 'components/landing/landing.css']) {
    it(`${file}: every comment closes`, () => {
      const css = read(join(SRC, file))
      const torn: number[] = []
      let i = 0
      for (;;) {
        const a = css.indexOf('/*', i)
        if (a < 0) break
        const b = css.indexOf('*/', a + 2)
        const next = css.indexOf('/*', a + 2)
        if (b < 0 || (next >= 0 && next < b)) torn.push(css.slice(0, a).split('\n').length)
        i = b < 0 ? css.length : b + 2
      }
      expect(torn).toEqual([])
    })
  }
})

describe('the app draws only with tokens', () => {
  for (const file of APP_CSS) {
    const css = outsideTokens(read(join(SRC, file)))
    it(`${file}: no raw colours`, () => {
      expect([...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => m[0])).toEqual([])
    })
    it(`${file}: no literal font sizes`, () => {
      expect([...css.matchAll(/font-size:\s*[0-9][^;]*;/g)].map((m) => m[0])).toEqual([])
    })
    it(`${file}: no numeric font weights`, () => {
      expect([...css.matchAll(/font-weight:\s*\d+|font:\s*\d{3}\b/g)].map((m) => m[0])).toEqual([])
    })
  }

  it('every token the app CSS uses is defined', () => {
    const defined = new Set(
      APP_CSS.flatMap((f) =>
        [...read(join(SRC, f)).matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]),
      ),
    )
    const used = new Set(
      APP_CSS.flatMap((f) =>
        [...read(join(SRC, f)).matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]),
      ),
    )
    // Set by a component inline, or by Ant.
    const local = new Set([
      '--cols',
      '--pip',
      '--tcol',
      '--face',
      '--i',
      '--overlap',
      '--composer-left',
      '--composer-width',
      '--welcome-offset',
      '--p',
      '--day',
      '--cat',
      '--swipe-p',
      '--sk-w',
      '--tab-x',
      '--tab-w',
      '--day-colour',
      '--chip-w',
      '--gm-fill',
      '--pos',
      '--steps',
    ])
    expect(
      [...used].filter((v) => !defined.has(v) && !local.has(v) && !v.startsWith('--ant')),
    ).toEqual([])
  })
})

describe('the desk under the browser bars', () => {
  // Browsers tint their bars and overscroll with the flat canvas colour, never the grain, so the
  // canvas and theme-color must be the desk's averaged tone or the bars read as a second grey.
  const styles = read(join(SRC, 'styles.css'))
  const tone = styles.match(/--desk-tone:\s*(#[0-9A-F]{6})/i)?.[1]

  it('paints the canvas the desk tone and the grained desk as a fixed layer over it', () => {
    expect(styles).toMatch(/\nhtml \{\n\s*background: var\(--desk-tone\);/)
    expect(styles).toMatch(/body::before \{[^}]*background: var\(--desk-fill\);/)
  })

  it('tells the browser the same colour', () => {
    expect(tone).toBeDefined()
    const html = read(join(SRC, '..', 'index.html'))
    expect(html).toContain(`<meta name="theme-color" content="${tone}" />`)
    const manifest = JSON.parse(read(join(SRC, '..', 'public', 'manifest.webmanifest')))
    expect(manifest.theme_color.toLowerCase()).toBe(tone?.toLowerCase())
  })
})

describe('the suggestion slip', () => {
  // It lies on the list's sheet, so it rests a hair above the page; a lift's ream and long drop
  // would bleed over the rows below it.
  it('rests as a slip, not a paper height', () => {
    const rule = read(join(SRC, 'styles.css')).match(/\.suggestion-sheet \{[^}]*\}/)?.[0]
    expect(rule).toContain('box-shadow: var(--slip-rest);')
    expect(rule).not.toMatch(/--lift-\d/)
  })
})
