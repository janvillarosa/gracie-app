// A small greedy label layout for the SVG map preview, so it behaves like the real map: labels
// are placed in priority order, try right, left, above, then below their pip, and a label that
// cannot fit without covering another label or a pip is dropped (the pip stays).
export type LabelItem = {
  id: string
  x: number
  y: number
  text: string
  // Lower first (selected 0, next 1, then the day's order).
  priority: number
}

export type Anchor = 'right' | 'left' | 'top' | 'bottom'

export type PlacedLabel = {
  id: string
  text: string
  x: number
  y: number
  w: number
  h: number
  anchor: Anchor
}

type Opts = {
  width: number
  height: number
  // Pip radius, label text height and an average glyph width (px).
  pip?: number
  textHeight?: number
  charWidth?: number
  gap?: number
  // Pips that carry no label of their own but must not be covered by one (e.g. stops whose
  // names only show on hover).
  obstacles?: Array<{ x: number; y: number }>
  // Items that must always be placed if at all possible are simply earlier in priority.
}

type Box = { x: number; y: number; w: number; h: number }
const hit = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export function placeLabels(items: LabelItem[], o: Opts): PlacedLabel[] {
  const pip = o.pip ?? 6.5
  const th = o.textHeight ?? 16
  const cw = o.charWidth ?? 6.9
  const gap = o.gap ?? 5
  const pipBoxes: Box[] = items.map((i) => ({
    x: i.x - pip - 1,
    y: i.y - pip - 1,
    w: (pip + 1) * 2,
    h: (pip + 1) * 2,
  }))
  const extra: Box[] = (o.obstacles ?? []).map((i) => ({
    x: i.x - pip - 1,
    y: i.y - pip - 1,
    w: (pip + 1) * 2,
    h: (pip + 1) * 2,
  }))
  const taken: Box[] = []
  const out: PlacedLabel[] = []
  const order = items
    .map((it, index) => ({ it, index }))
    .sort((a, b) => a.it.priority - b.it.priority || a.index - b.index)
  for (const { it, index } of order) {
    const w = Math.ceil(it.text.length * cw) + 4
    const options: Array<[Anchor, Box]> = [
      ['right', { x: it.x + pip + gap, y: it.y - th / 2, w, h: th }],
      ['left', { x: it.x - pip - gap - w, y: it.y - th / 2, w, h: th }],
      ['top', { x: it.x - w / 2, y: it.y - pip - gap - th, w, h: th }],
      ['bottom', { x: it.x - w / 2, y: it.y + pip + gap, w, h: th }],
    ]
    for (const [anchor, box] of options) {
      if (box.x < 2 || box.y < 2 || box.x + box.w > o.width - 2 || box.y + box.h > o.height - 2)
        continue
      if (taken.some((t) => hit(t, box))) continue
      if (pipBoxes.some((p, i) => i !== index && hit(p, box))) continue
      if (extra.some((p) => hit(p, box))) continue
      taken.push(box)
      out.push({ id: it.id, text: it.text, anchor, ...box })
      break
    }
  }
  return out
}
