// The DOM for one marker, built from plain data so each state can be tested without a map.
//
//   <div class="gm-pin ...">            a 0x0 box: its bottom-centre (where Google anchors a marker)
//     <span class="gm-pip">             is the stop's exact point; everything is drawn around it
//     <span class="gm-label">Name</span>
//
// The pip is a category colour (`--pip-*`); all-days mode colours it by day, done is muted, ideas
// are hollow. The next and selected stops get a yellow ring. The name is Figtree SemiBold with a
// white halo, all in CSS (gmap.css).
import type { MapScene, MapStop } from '@lib/trips/mapScene'
import { isLabelled, type Anchor } from './labels'

export type PinState = {
  next: boolean
  selected: boolean
  done: boolean
  hollow: boolean
  dim: boolean
  hot: boolean
  // The name shows without hovering (a day); otherwise only on hover or when lit from the list.
  labelled: boolean
  // The collision pass hid the name (the pip stays).
  hidden: boolean
  anchor: Anchor
}

export type PinSpec = {
  text: string
  title: string
  // CSS custom property names (without `var()`), so colours stay tokens.
  fill: string
  stroke: string
  state: PinState
}

const BOOLEAN_CLASSES: Array<[keyof PinState, string]> = [
  ['next', 'is-next'],
  ['selected', 'is-selected'],
  ['done', 'is-done'],
  ['hollow', 'is-hollow'],
  ['dim', 'is-dim'],
  ['hot', 'is-hot'],
  ['labelled', 'is-labelled'],
  ['hidden', 'label-hidden'],
]

/** Which tokens colour a stop's pip. */
export function pipColours(
  stop: MapStop,
  scene: Pick<MapScene, 'mode'>,
): { fill: string; stroke: string } {
  const hollow = scene.mode === 'ideas'
  const fill = hollow
    ? '--panel'
    : stop.done
      ? '--pip-done'
      : scene.mode === 'all'
        ? `--trip-day-${stop.dayIndex % 6}`
        : `--pip-${stop.category}`
  return { fill, stroke: hollow ? `--pip-${stop.category}` : '--on-pin' }
}

export function pinState(
  stop: MapStop,
  scene: MapScene,
  opts: { hot: boolean; hidden: boolean; anchor: Anchor },
): PinState {
  return {
    next: stop.id === scene.nextId,
    selected: stop.id === scene.selectedId,
    done: stop.done,
    hollow: scene.mode === 'ideas',
    dim:
      scene.emphasisDay !== undefined &&
      scene.emphasisDay !== null &&
      stop.dayIndex !== scene.emphasisDay,
    hot: opts.hot,
    labelled: isLabelled(scene, stop),
    hidden: opts.hidden,
    anchor: opts.anchor,
  }
}

export function classesFor(state: PinState): string {
  const out = ['gm-pin', `a-${state.anchor}`]
  for (const [key, cls] of BOOLEAN_CLASSES) if (state[key]) out.push(cls)
  return out.join(' ')
}

/** Create the marker's content once, then `updatePin` it as the scene changes. */
export function createPin(): HTMLDivElement {
  const root = document.createElement('div')
  const pip = document.createElement('span')
  pip.className = 'gm-pip'
  const label = document.createElement('span')
  label.className = 'gm-label'
  root.append(pip, label)
  return root
}

export function updatePin(root: HTMLElement, spec: PinSpec) {
  root.className = classesFor(spec.state)
  root.style.setProperty('--gm-fill', `var(${spec.fill})`)
  root.style.setProperty('--gm-stroke', `var(${spec.stroke})`)
  const label = root.querySelector('.gm-label')
  if (label && label.textContent !== spec.text) label.textContent = spec.text
}

/** A merged group of stops: a white disc with "+N" and an ink border. */
export function clusterElement(count: number): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'gm-cluster'
  const disc = document.createElement('span')
  disc.className = 'gm-cluster-disc'
  disc.textContent = `+${count}`
  root.append(disc)
  return root
}

/** The hollow pin for a place being considered (the add bar's highlighted suggestion). */
export function previewElement(): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'gm-preview'
  const ring = document.createElement('span')
  ring.className = 'gm-preview-ring'
  root.append(ring)
  return root
}
