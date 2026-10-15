// The DOM for one marker, built from plain data so each state can be tested without a map.
//
//   <div class="gm-pin ...">            a 0x0 box: its top-left is the stop's exact point
//     <span class="gm-anchor">          the 10px ring on the point
//     <span class="gm-pill">            the pill, standing above the anchor with a pointer tail
//       <span class="gm-kicker">Next</span>  <i class="gm-dot"> <span class="gm-name"> <span class="gm-time">
//
// A stop is a white paper pill (brief 6u). The next stop is the yellow key pill with a NEXT
// kicker, a done stop is grey, the selected one has a 2px ink outline, ideas are outlined. A
// pill that collides, or belongs to another day, collapses to its anchor and dot and expands on
// hover. All of it is CSS (gmap.css).
import type { MapScene, MapStop } from '@lib/trips/mapScene'
import { isFull } from './labels'

export type PinState = {
  next: boolean
  selected: boolean
  done: boolean
  hollow: boolean
  dim: boolean
  hot: boolean
  // The pill shows in full without hovering (a day, the emphasised day, the next and selected).
  labelled: boolean
  // The collision pass collapsed the pill (the anchor and dot stay).
  hidden: boolean
  // The NEXT kicker shows (desktop only).
  kicker: boolean
}

export type PinSpec = {
  name: string
  // "10:15"; empty when none, or on the phone.
  time: string
  title: string
  // The CSS custom property name (without `var()`) of the stop's colour, so colours stay tokens.
  fill: string
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
  ['kicker', 'has-kicker'],
]

/** Which token colours a stop's dot and anchor. */
export function pipColours(stop: MapStop, scene: Pick<MapScene, 'mode'>): { fill: string } {
  return {
    fill: stop.done
      ? '--pip-done'
      : scene.mode === 'all'
        ? `--trip-day-${stop.dayIndex % 6}`
        : `--pip-${stop.category}`,
  }
}

export function pinState(
  stop: MapStop,
  scene: MapScene,
  opts: { hot: boolean; hidden: boolean; kicker: boolean },
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
    labelled: isFull(scene, stop),
    hidden: opts.hidden,
    kicker: opts.kicker && stop.id === scene.nextId,
  }
}

export function classesFor(state: PinState): string {
  const out = ['gm-pin']
  for (const [key, cls] of BOOLEAN_CLASSES) if (state[key]) out.push(cls)
  return out.join(' ')
}

const span = (cls: string, tag: 'span' | 'i' = 'span') => {
  const el = document.createElement(tag)
  el.className = cls
  return el
}

/** Create the marker's content once, then `updatePin` it as the scene changes. The pill is
 *  decoration for the map; the list is the accessible source, so it is hidden from readers. */
export function createPin(): HTMLDivElement {
  const root = document.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  const pill = span('gm-pill')
  const kicker = span('gm-kicker')
  kicker.textContent = 'Next'
  pill.append(kicker, span('gm-dot', 'i'), span('gm-name'), span('gm-time'))
  root.append(span('gm-anchor'), pill)
  return root
}

export function updatePin(root: HTMLElement, spec: PinSpec) {
  root.className = classesFor(spec.state)
  root.style.setProperty('--gm-fill', `var(${spec.fill})`)
  const name = root.querySelector('.gm-name')
  if (name && name.textContent !== spec.name) name.textContent = spec.name
  const time = root.querySelector('.gm-time')
  if (time && time.textContent !== spec.time) time.textContent = spec.time
}

/** A merged group of stops: an ink pill with "+N". */
export function clusterElement(count: number): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'gm-cluster'
  root.setAttribute('aria-hidden', 'true')
  const pill = document.createElement('span')
  pill.className = 'gm-cluster-pill'
  pill.textContent = `+${count}`
  root.append(pill)
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
