// The design system holds only if nothing quietly goes around it. These read the source.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = (p: string) => relative(SRC, p)
const all = walk(SRC).filter((p) => !p.includes('__tests__'))
const read = (p: string) => readFileSync(p, 'utf8')

/** Names imported from 'antd' by a file. */
function antdImports(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/import\s*(type\s*)?\{([^}]*)\}\s*from\s*'antd'/g)) {
    if (m[1]) continue
    for (const part of m[2].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]
      if (name) out.push(name)
    }
  }
  return out
}

const isTripFile = (p: string) =>
  rel(p).startsWith('components/trips/') ||
  /^pages\/Trip[A-Za-z]*\.tsx$/.test(rel(p)) ||
  rel(p) === 'pages/DevUi.tsx'

describe('overlays and form controls come from components/ui', () => {
  const BANNED_IN_TRIPS = [
    'Modal',
    'Drawer',
    'Popover',
    'Input',
    'Select',
    'Button',
    'Switch',
    'DatePicker',
  ]

  it('no trip file imports an Ant overlay or form control', () => {
    const offenders = all
      .filter(isTripFile)
      .filter((p) => /\.tsx?$/.test(p))
      .flatMap((p) =>
        antdImports(read(p))
          .filter((n) => BANNED_IN_TRIPS.includes(n))
          .map((n) => `${rel(p)}: ${n}`),
      )
    expect(offenders).toEqual([])
  })

  it('the House and account screens and their overlays are Sheets, not Ant Modals, Drawers or forms', () => {
    const files = [
      'pages/RoomPage.tsx',
      'pages/RoomSettings.tsx',
      'pages/NoRoomPage.tsx',
      'pages/UserSettings.tsx',
      'pages/UserSettings.tsx',
      'components/ShareCodeSheet.tsx',
      'components/CreateHouseSheet.tsx',
      'components/DeleteVoteSheet.tsx',
      'components/IconPicker.tsx',
    ]
    const offenders = files.flatMap((f) =>
      antdImports(read(join(SRC, f)))
        .filter((n) => ['Modal', 'Drawer', 'Popover', 'Form', 'Input'].includes(n))
        .map((n) => `${f}: ${n}`),
    )
    expect(offenders).toEqual([])
  })

  it('only the ui Sheet imports Modal, Drawer or Popover among the ui primitives', () => {
    const offenders = all
      .filter((p) => rel(p).startsWith('components/ui/') && rel(p) !== 'components/ui/Sheet.tsx')
      .filter((p) => /\.tsx?$/.test(p))
      .flatMap((p) =>
        antdImports(read(p))
          .filter((n) => ['Modal', 'Drawer', 'Popover'].includes(n))
          .map((n) => `${rel(p)}: ${n}`),
      )
    expect(offenders).toEqual([])
  })
})

describe('trip and ui styles use tokens, not literals', () => {
  const css = ['trips.css', 'components/ui/ui.css']

  /** The stylesheet without :root blocks (where tokens are defined) and comments. */
  const withoutRoot = (src: string) => {
    let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
    out = out.replace(/:root\s*\{[^}]*\}/g, '')
    return out
  }

  for (const file of css) {
    it(`${file} has no hex colours outside :root`, () => {
      const hits = [...withoutRoot(read(join(SRC, file))).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(
        (m) => m[0],
      )
      expect(hits).toEqual([])
    })

    it(`${file} has no side-stripe accent borders`, () => {
      const hits = [
        ...withoutRoot(read(join(SRC, file))).matchAll(
          /border-(left|right)\s*:\s*[2-9]px\s+solid[^;]*;/g,
        ),
      ].map((m) => m[0])
      expect(hits).toEqual([])
    })
  }

  it('every colour token the ui styles use is defined on :root', () => {
    const styles = read(join(SRC, 'styles.css')) + read(join(SRC, 'trips.css'))
    const defined = new Set([...styles.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
    const used = [
      ...new Set(
        [...read(join(SRC, 'components/ui/ui.css')).matchAll(/var\((--[a-z0-9-]+)/gi)].map(
          (m) => m[1],
        ),
      ),
    ]
    // Local custom properties a component sets itself.
    const local = new Set(['--cols', '--pip', '--tcol'])
    expect(used.filter((v) => !defined.has(v) && !local.has(v))).toEqual([])
  })

  it('presses animate only when motion is allowed, and touch targets reach 44px', () => {
    const css = read(join(SRC, 'components/ui/ui.css'))
    // Every transition on a ui-btn sits inside a no-preference media block.
    const loose = css
      .replace(/@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\n\}/g, '')
      .match(/\.ui-btn\s*\{[^}]*transition:/)
    expect(loose).toBeNull()
    expect(css).toMatch(/@media \(pointer: coarse\)[\s\S]*max\(100%, 44px\)/)
    expect(css).toMatch(/\.trip-check \.ant-checkbox-wrapper\s*\{[^}]*padding: 11px/)
  })
})
