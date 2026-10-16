// Copies the app's token block (the `:root` between the design-token markers in src/styles.css)
// into the living design-system reference, docs/design-system/index.html, so the reference always
// shows the values the app actually uses. Run after changing a token:
//   pnpm design:sync
// __tests__/designTokens.test.ts fails while the two differ.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const stylesPath = path.resolve(here, '../src/styles.css')
const docPath = path.resolve(here, '../../docs/design-system/index.html')

export const tokenBlock = (css) => {
  const m = css.match(/\/\* =+\s*\n\s*Design tokens:[\s\S]*?\n:root \{[\s\S]*?\n\}\n/)
  if (!m) throw new Error('No design-token block found in styles.css')
  return m[0]
}

const START = '<style id="design-tokens">'
const END = '</style><!-- /design-tokens -->'

export const syncDoc = (css, html) => {
  const a = html.indexOf(START)
  const b = html.indexOf(END)
  if (a < 0 || b < 0) throw new Error('No design-tokens style block in the reference page')
  return `${html.slice(0, a + START.length)}\n${tokenBlock(css)}${html.slice(b)}`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const css = fs.readFileSync(stylesPath, 'utf8')
  const html = fs.readFileSync(docPath, 'utf8')
  const next = syncDoc(css, html)
  if (next !== html) {
    fs.writeFileSync(docPath, next)
    console.log('design tokens synced into docs/design-system/index.html')
  } else console.log('design tokens already in step')
}
