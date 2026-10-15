import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripMap } from '@components/trips/TripMap'
import { MapController } from '@components/trips/gmap/controller'
import { centreFor, isVisible, projector, worldPoint } from '@components/trips/gmap/geometry'
import { pillSize, pillText, resolvePills } from '@components/trips/gmap/labels'
import { loadGoogle, resetGoogleLoader, type Google } from '@components/trips/gmap/loader'
import { mapsConfig, mapsEnabled } from '@components/trips/gmap/config'
import { pinState, pipColours } from '@components/trips/gmap/pin'
import type { MapViewProps } from '@components/trips/mapView'
import { buildScene, EMPTY_SCENE, type MapScene, type MapStop } from '@lib/trips/mapScene'
import {
  FakeClusterer,
  FakeMap,
  FakeMarker,
  FakePolyline,
  fakeLayout,
  importLibrary,
  libs,
  resetGoogleFake,
  setOptions,
} from './googleFake'

vi.mock('@googlemaps/js-api-loader', async () => (await import('./googleFake')).loaderMock())
vi.mock('@googlemaps/markerclusterer', async () => (await import('./googleFake')).clustererMock())

const stop = (id: string, lat: number, lng: number, over: Partial<MapStop> = {}): MapStop => ({
  id,
  lat,
  lng,
  label: id,
  category: 'food',
  done: false,
  priority: 2,
  dayIndex: 0,
  meta: '',
  ...over,
})
const scene = (stops: MapStop[], over: Partial<MapScene> = {}): MapScene => ({
  ...EMPTY_SCENE,
  stops,
  route: true,
  ...over,
})
const props = (s: MapScene, over: Partial<MapViewProps> = {}): MapViewProps => ({
  scene: s,
  interactive: true,
  labelLimit: 22,
  nextPrefix: true,
  following: true,
  fitToken: 0,
  title: 'Map',
  onPinClick: vi.fn(),
  ...over,
})

const google = () => libs() as unknown as Google
const make = (p: MapViewProps) => {
  const container = document.createElement('div')
  document.body.append(container)
  const ctl = new MapController({
    google: google(),
    container,
    config: { key: 'k', mapId: 'DEMO_MAP_ID' },
    props: p,
  })
  const map = FakeMap.last as FakeMap
  // The map's first idle: it is up, and the first fit runs.
  map.emit('idle')
  return { ctl, container, map }
}
const pin = (id: string) => FakeMarker.pins().find((m) => m.title === id) as FakeMarker

const A = stop('a', 38.7, -9.15, { priority: 2 })
const B = stop('b', 38.8, -9.4, { priority: 3 })
const C = stop('c', 38.75, -9.3, { priority: 4 })

beforeEach(() => {
  resetGoogleFake()
  resetGoogleLoader()
  fakeLayout()
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the adapter contract on the Google map (scene / preview / fit / pill clicks)', () => {
  it('draws one marker per stop with our own HTML, and fits the whole trip on load', () => {
    const { map } = make(props(scene([A, B, C])))
    expect(FakeMarker.pins()).toHaveLength(3)
    expect(FakeMarker.pins().every((m) => m.gmpClickable)).toBe(true)
    expect(map.options).toMatchObject({
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
    })
    expect(map.listeners.has('click')).toBe(false)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    const [bounds, padding] = map.fitBounds.mock.calls[0]
    expect(bounds.points).toHaveLength(3)
    expect(padding).toEqual({ top: 84, bottom: 56, left: 112, right: 112 })
  })

  it('joins the day with a 5px line on a 10px white casing and chevrons, and nothing for one stop', () => {
    make(props(scene([A, B, C], { colourVar: '--trip-day-2' })))
    const [casing, line] = FakePolyline.all.map((l) => l.options)
    expect(FakePolyline.all).toHaveLength(2)
    expect(casing).toMatchObject({ strokeWeight: 10, strokeColor: '#ffffff' })
    expect(casing.path).toHaveLength(3)
    expect(line.strokeWeight).toBe(5)
    expect(line.strokeOpacity).toBe(1)
    expect(line.icons[0].icon.fillColor).toBe('#ffffff')
    expect(line.icons[0].repeat).toBe('100px')
    make(props(scene([A])))
    expect(FakePolyline.all.filter((l) => l.live)).toHaveLength(2)
  })

  it('dots a transport leg in --trip-transport, and keeps the rest solid', () => {
    const train = stop('t', 38.9, -9.1, { category: 'transport' })
    make(props(scene([A, B, train, C])))
    const lines = FakePolyline.all.map((l) => l.options)
    // Solid A-B, dotted B-train, solid train-C: a casing under each.
    expect(lines.filter((l) => l.strokeWeight === 5)).toHaveLength(2)
    const dots = lines.filter((l) => l.strokeOpacity === 0)
    expect(dots).toHaveLength(1)
    expect(dots[0].path).toHaveLength(2)
    expect(dots[0].icons[0].repeat).toBe('10px')
    expect(lines.filter((l) => l.strokeWeight === 9)).toHaveLength(1)
  })

  it('swaps the pins when the scene changes, reusing markers and removing the gone ones', () => {
    const { ctl } = make(props(scene([A, B])))
    const first = pin('a')
    ctl.sync(props(scene([A, C])))
    expect(pin('a')).toBe(first)
    expect(FakeMarker.pins().find((m) => m.title === 'b')?.shown).toBe(false)
    expect(FakeMarker.pins().find((m) => m.title === 'c')?.shown).toBe(true)
  })

  it('reports a tap on a pin', () => {
    const p = props(scene([A, B]))
    make(p)
    pin('b').click()
    expect(p.onPinClick).toHaveBeenCalledWith('b')
  })

  it('fits again on the fit token, and on a new set of stops only while following', () => {
    const { ctl, map } = make(props(scene([A, B])))
    map.clearMoves()
    ctl.sync(props(scene([A, B]), { fitToken: 1 }))
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    map.clearMoves()
    ctl.sync(props(scene([A, B, C]), { fitToken: 1, following: false }))
    expect(map.moves).toBe(0)
    ctl.sync(props(scene([A, C]), { fitToken: 1, following: true }))
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
  })

  it('zooms to a single place instead of fitting a point', () => {
    const { map } = make(props(scene([A])))
    expect(map.setCenter).toHaveBeenCalledWith({ lat: A.lat, lng: A.lng })
    expect(map.setZoom).toHaveBeenCalledWith(15)
    expect(map.fitBounds).not.toHaveBeenCalled()
  })

  it('keeps a few close stops from zooming in to the rooftops', () => {
    const { map } = make(props(scene([A, B])))
    map.view.zoom = 19
    map.emit('idle')
    expect(map.setZoom).toHaveBeenCalledWith(15)
  })

  it('previews a place as a hollow ring, and clears it', () => {
    const { ctl, map } = make(props(scene([A, B])))
    expect(FakeMarker.preview()).toBeUndefined()
    // In view: no camera move.
    map.clearMoves()
    ctl.sync(props(scene([A, B]), { preview: { lat: 38.72, lng: -9.2 } }))
    expect(FakeMarker.preview()?.shown).toBe(true)
    expect(map.moves).toBe(0)
    // Off screen: bring it into view.
    ctl.sync(props(scene([A, B]), { preview: { lat: 41.1, lng: -8.6 } }))
    expect(map.panTo).toHaveBeenCalledWith({ lat: 41.1, lng: -8.6 })
    ctl.sync(props(scene([A, B]), { preview: null }))
    expect(FakeMarker.preview()?.shown).toBe(false)
  })

  it('brings an opened item into the space left of a panel only when its pin is hidden', () => {
    const { ctl, map } = make(props(scene([A, B])))
    map.clearMoves()
    // Visible: stays put.
    ctl.sync(props(scene([A, B]), { focusPoint: { lat: 38.7, lng: -9.0 }, focusInset: 0 }))
    expect(map.moves).toBe(0)
    // Off screen: pans, with the centre shifted so the pin clears the panel.
    ctl.sync(props(scene([A, B]), { focusPoint: { lat: 41.1, lng: -8.6 }, focusInset: 420 }))
    expect(map.panTo).toHaveBeenCalledTimes(1)
    const to = map.panTo.mock.calls[0][0]
    expect(to.lng).toBeGreaterThan(-8.6)
    expect(to.lat).toBeCloseTo(41.1, 1)
  })

  it('tells the page when the person drags or zooms, not for its own moves', () => {
    const p = props(scene([A, B]), { onUserMove: vi.fn() })
    const { ctl, map } = make(p)
    // Its own fit is running: a zoom change is not the person.
    map.emit('zoom_changed')
    expect(p.onUserMove).not.toHaveBeenCalled()
    map.emit('idle')
    map.emit('zoom_changed')
    expect(p.onUserMove).toHaveBeenCalledTimes(1)
    map.emit('dragstart')
    expect(p.onUserMove).toHaveBeenCalledTimes(2)
    ctl.zoomBy(1)
    expect(map.setZoom).toHaveBeenLastCalledWith(11)
    expect(p.onUserMove).toHaveBeenCalledTimes(3)
  })

  it('waits for the map to be up, so its start-up idle is not taken for the fit that follows', () => {
    const p = props(scene([A, B]), { onUserMove: vi.fn() })
    const container = document.createElement('div')
    document.body.append(container)
    new MapController({ google: google(), container, config: { key: 'k', mapId: 'M' }, props: p })
    const map = FakeMap.last as FakeMap
    expect(map.fitBounds).not.toHaveBeenCalled()
    // The first idle: the map is up, and the first fit runs and is still running.
    map.emit('idle')
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    map.emit('zoom_changed')
    expect(p.onUserMove).not.toHaveBeenCalled()
    // Its own idle ends the move; after that a zoom is the person.
    map.emit('idle')
    map.emit('zoom_changed')
    expect(p.onUserMove).toHaveBeenCalledTimes(1)
  })

  it('a later move keeps its own claim when an earlier move times out', () => {
    vi.useFakeTimers()
    const p = props(scene([A, B]), { onUserMove: vi.fn() })
    const { ctl, map } = make(p)
    vi.advanceTimersByTime(1000)
    ctl.sync(props(scene([A, B]), { fitToken: 1, onUserMove: p.onUserMove }))
    vi.advanceTimersByTime(600)
    // The first move's 1.5s fallback has passed; the second is still running.
    map.emit('zoom_changed')
    expect(p.onUserMove).not.toHaveBeenCalled()
  })

  it('clears everything on destroy', () => {
    const { ctl, container } = make(props(scene([A, B])))
    ctl.destroy()
    expect(FakeMarker.pins().every((m) => !m.shown)).toBe(true)
    expect(FakePolyline.all.every((l) => !l.live)).toBe(true)
    expect(container.childNodes).toHaveLength(0)
  })
})

describe('what each pill looks like', () => {
  const base = scene([A, B, C], { nextId: 'a', selectedId: 'b' })
  it('puts the category colour in the dot and anchor, the next stop in the key pill and the selected one outlined', () => {
    make(props(base))
    expect(pin('a').content).toHaveClass('gm-pin', 'is-next', 'has-kicker')
    expect(pin('b').content).toHaveClass('is-selected')
    expect(pin('c').content).not.toHaveClass('is-next', 'is-selected')
    expect(pin('c').content.style.getPropertyValue('--gm-fill')).toBe('var(--pip-food)')
    expect(pin('c').content.querySelector('.gm-anchor')).not.toBeNull()
    expect(pin('c').content.querySelector('.gm-dot')).not.toBeNull()
  })

  it('shows the NEXT kicker only for the next stop and only when asked, the time on the desk only, and cuts long names', () => {
    const long = stop('l', 38.9, -9.1, {
      label: 'Quinta da Regaleira do Convento de Sintra',
      time: '14:00',
    })
    const { ctl } = make(props(scene([A, long], { nextId: 'a' })))
    expect(pin('a').content).toHaveClass('has-kicker')
    expect(pin('a').label).toBe('a')
    const lm = () => FakeMarker.pins().find((m) => m.title.startsWith('Quinta')) as FakeMarker
    expect(lm().label).toHaveLength(22)
    expect(lm().label.endsWith('…')).toBe(true)
    expect(lm().time).toBe('14:00')
    ctl.sync(
      props(scene([A, long], { nextId: 'a' }), {
        nextPrefix: false,
        labelLimit: 16,
        interactive: false,
      }),
    )
    expect(pin('a').content).not.toHaveClass('has-kicker')
    expect(lm().label).toBe('Quinta da Regal…')
    expect(lm().label).toHaveLength(16)
    expect(lm().time).toBe('')
    expect(pillText(long, 14)).toHaveLength(14)
  })

  it('greys a done stop, and outlines ideas in the category colour', () => {
    const done = stop('d', 38.9, -9.1, { done: true })
    const { ctl } = make(props(scene([A, done])))
    expect(pin('d').content).toHaveClass('is-done')
    expect(pin('d').content.style.getPropertyValue('--gm-fill')).toBe('var(--pip-done)')
    ctl.sync(props(scene([A, done], { mode: 'ideas' })))
    expect(pin('a').content).toHaveClass('is-hollow')
    expect(pin('a').content.style.getPropertyValue('--gm-fill')).toBe('var(--pip-food)')
  })

  it('colours by day in all-days mode, with names on hover only, and dims the other days', () => {
    const d1 = stop('x', 38.9, -9.1, { dayIndex: 1 })
    make(props(scene([A, d1], { mode: 'all', route: false, emphasisDay: 0 })))
    expect(pin('x').content.style.getPropertyValue('--gm-fill')).toBe('var(--trip-day-1)')
    expect(pin('a').content.style.getPropertyValue('--gm-fill')).toBe('var(--trip-day-0)')
    expect(pin('x').content).not.toHaveClass('is-labelled')
    expect(pin('x').content).toHaveClass('is-dim')
    expect(pin('a').content).not.toHaveClass('is-dim')
  })

  it('names the stops of the day in emphasis, so scrolling the list moves the names, not the camera', () => {
    const d1 = stop('x', 38.9, -9.1, { dayIndex: 1 })
    const { ctl, map } = make(props(scene([A, d1], { mode: 'all', route: false, emphasisDay: 0 })))
    expect(pin('a').content).toHaveClass('is-labelled')
    expect(pin('x').content).not.toHaveClass('is-labelled')
    map.clearMoves()
    ctl.sync(props(scene([A, d1], { mode: 'all', route: false, emphasisDay: 1 })))
    expect(pin('x').content).toHaveClass('is-labelled')
    expect(pin('a').content).not.toHaveClass('is-labelled')
    expect(map.moves).toBe(0)
  })

  it('fits the day in emphasis on load and on an explicit fit; no emphasis (Show all days) fits the whole trip', () => {
    const d1 = stop('x', 38.9, -9.1, { dayIndex: 1 })
    const far = stop('y', 41.1, -8.6, { dayIndex: 2 })
    const { ctl, map } = make(
      props(scene([A, B, d1, far], { mode: 'all', route: false, emphasisDay: 0 })),
    )
    // On load: the day in emphasis (day 0 has two stops).
    expect(map.fitBounds.mock.calls[0][0].points).toHaveLength(2)
    map.clearMoves()
    ctl.sync(props(scene([A, B, d1, far], { mode: 'all', route: false, emphasisDay: 1 })))
    expect(map.moves).toBe(0)
    ctl.sync(
      props(scene([A, B, d1, far], { mode: 'all', route: false, emphasisDay: 1 }), { fitToken: 1 }),
    )
    expect(map.moves).toBe(1)
    // Day 1 has one stop: centred, not the whole trip.
    expect(map.setCenter).toHaveBeenCalled()
    map.clearMoves()
    ctl.sync(
      props(scene([A, B, d1, far], { mode: 'all', route: false, emphasisDay: null }), {
        fitToken: 2,
      }),
    )
    expect(map.fitBounds.mock.calls[0][0].points).toHaveLength(4)
  })

  it('fits the first day with places when the emphasised day has none', () => {
    const d1 = stop('x', 38.9, -9.1, { dayIndex: 1 })
    const far = stop('y', 41.1, -8.6, { dayIndex: 2 })
    const { map } = make(props(scene([d1, far], { mode: 'all', route: false, emphasisDay: 0 })))
    expect(map.setCenter).toHaveBeenCalledWith({ lat: 38.9, lng: -9.1 })
  })

  it('looks at the trip, not the whole world, when the view has no stops at all', () => {
    // Every place dated outside the trip: nothing to draw, but the trip still has places.
    const home = [
      { lat: 38.7, lng: -9.15 },
      { lat: 41.1, lng: -8.6 },
    ]
    const { map } = make(props(scene([], { mode: 'all', route: false, emphasisDay: 0 }), { home }))
    expect(map.fitBounds.mock.calls[0][0].points).toHaveLength(2)
    // Only the destination known: centred on it.
    const one = make(
      props(scene([], { mode: 'all', route: false, emphasisDay: 0 }), {
        home: [{ lat: 38.72, lng: -9.14 }],
      }),
    )
    expect(one.map.setCenter).toHaveBeenCalledWith({ lat: 38.72, lng: -9.14 })
    // Nothing at all: the map stays where it is rather than guessing.
    const none = make(props(scene([], { mode: 'all', route: false, emphasisDay: 0 })))
    expect(none.map.fitBounds).not.toHaveBeenCalled()
    expect(none.map.setCenter).not.toHaveBeenCalled()
  })

  it('has the same states as pure functions', () => {
    const s = scene([A], { mode: 'all' })
    expect(pipColours(A, s)).toEqual({ fill: '--trip-day-0' })
    const st = pinState(
      A,
      { ...s, nextId: 'a', emphasisDay: 3 },
      { hot: true, hidden: false, kicker: true },
    )
    // The next stop is always in full, even on another day.
    expect(st).toMatchObject({ next: true, dim: true, hot: true, labelled: true, kicker: true })
  })

  it('lifts a hovered stop and shows its name even in all-days mode', () => {
    const d1 = stop('x', 38.9, -9.1, { dayIndex: 1 })
    const { ctl } = make(props(scene([A, d1], { mode: 'all', route: false })))
    ctl.sync(props(scene([A, d1], { mode: 'all', route: false }), { hotId: 'x' }))
    expect(pin('x').content).toHaveClass('is-hot')
    expect(pin('a').content).not.toHaveClass('is-hot')
    expect(pin('x').zIndex).toBeGreaterThan(pin('a').zIndex as number)
  })
})

describe('clustering', () => {
  it('clusters stacked stops, but never the next or the selected one', () => {
    make(props(scene([A, B, C], { nextId: 'a', selectedId: 'b' })))
    const cl = FakeClusterer.last as FakeClusterer
    expect(cl.markers.map((m) => m.title)).toEqual(['c'])
    expect(pin('a').shown && pin('b').shown).toBe(true)
  })

  it('never clusters the pins of the emphasised day; only the other days cluster', () => {
    const x = stop('x', 38.9, -9.1, { dayIndex: 1 })
    const y = stop('y', 38.91, -9.1, { dayIndex: 1 })
    make(props(scene([A, B, x, y], { mode: 'all', route: false, emphasisDay: 1 })))
    const cl = FakeClusterer.last as FakeClusterer
    expect(cl.markers.map((m) => m.title).sort()).toEqual(['a', 'b'])
    expect(pin('x').shown && pin('y').shown).toBe(true)
  })

  it('renders a cluster as an ink pill with +N, and zooms in when it is clicked', () => {
    const p = props(scene([A, B, C]), { onUserMove: vi.fn() })
    const { map } = make(p)
    const cl = FakeClusterer.last as FakeClusterer
    const marker = cl.stack([pin('a'), pin('b')])
    expect(marker.content).toHaveClass('gm-cluster')
    expect(marker.content.textContent).toBe('+2')
    const bounds = { fake: true }
    cl.onClusterClick({}, { bounds }, map)
    expect(map.fitBounds).toHaveBeenLastCalledWith(bounds, expect.anything())
  })
})

describe('the pill collision pass (after idle)', () => {
  // Five stops on one spot: only one pill fits above it; the rest collapse to anchor and dot.
  const stack = (n: number) =>
    Array.from({ length: n }, (_, i) => stop(`s${i}`, 38.7, -9.15, { priority: i + 2 }))

  it('keeps the highest priority and collapses the ones that would overlap; every anchor stays', () => {
    const { ctl, map } = make(props(scene(stack(3))))
    map.view.zoom = 10
    map.emit('idle')
    ctl.layoutLabels()
    const collapsed = FakeMarker.pins().filter((m) => m.content.classList.contains('label-hidden'))
    expect(collapsed.map((m) => m.title)).toEqual(['s1', 's2'])
    expect(FakeMarker.pins().every((m) => m.shown && m.content.querySelector('.gm-anchor'))).toBe(
      true,
    )
  })

  it('lets a hovered stop in even when it would collide', () => {
    const { ctl, map } = make(props(scene(stack(3))))
    map.view.zoom = 10
    map.emit('idle')
    ctl.sync(props(scene(stack(3)), { hotId: 's2' }))
    ctl.layoutLabels()
    expect(pin('s2').content).not.toHaveClass('label-hidden')
    expect(pin('s2').content).toHaveClass('is-hot')
  })

  it('does not collapse clustered stops that are not on the map', () => {
    const { ctl, map } = make(props(scene(stack(3))))
    const cl = FakeClusterer.last as FakeClusterer
    cl.stack(FakeMarker.pins().slice(0, 2))
    map.view.zoom = 10
    map.emit('idle')
    ctl.layoutLabels()
    expect(
      FakeMarker.pins().filter((m) => m.shown && m.content.classList.contains('label-hidden')),
    ).toHaveLength(0)
  })

  it('is a pure greedy pass: priority order, the selected and next always kept, the loser dropped', () => {
    const size = pillSize({ name: 'Some place' })
    const at = (id: string, x: number, y: number, priority: number, hot = false) => ({
      id,
      x,
      y,
      ...size,
      priority,
      hot,
    })
    const items = [at('p2', 200, 150, 2), at('p3', 210, 150, 3), at('p4', 190, 150, 4)]
    expect([...resolvePills(items)]).toEqual(['p2'])
    // The order in the list does not matter, priority does.
    expect([...resolvePills([...items].reverse())]).toEqual(['p2'])
    // A hovered stop jumps the queue; the next stop is always kept.
    expect(resolvePills(items.map((i) => ({ ...i, hot: i.id === 'p4' }))).has('p4')).toBe(true)
    expect(resolvePills([...items, at('n', 205, 150, 1)]).has('n')).toBe(true)
    // Apart, both stay.
    expect([...resolvePills([items[0], at('far', 200, 300, 3)])].sort()).toEqual(['far', 'p2'])
  })

  it('never lets a pill sit on the anchor of another stop', () => {
    const size = pillSize({ name: 'Name' })
    const items = [{ id: 'a', x: 100, y: 100, ...size, priority: 3 }]
    expect(resolvePills(items).has('a')).toBe(true)
    // Another stop's anchor right where the pill stands.
    expect(resolvePills(items, [{ x: 100, y: 100 - 10 - size.h / 2 }]).has('a')).toBe(false)
  })

  it('sizes a pill from its name, time and kicker; the phone pill is smaller and has no time', () => {
    const desk = pillSize({ name: 'Pena Palace', time: '10:15', kicker: true })
    const bare = pillSize({ name: 'Pena Palace' })
    expect(desk.h).toBe(34)
    expect(desk.w).toBeGreaterThan(bare.w)
    const phone = pillSize({ name: 'Pena Palace', time: '10:15', compact: true })
    expect(phone.h).toBe(30)
    expect(phone.w).toBeLessThan(bare.w)
  })
})

describe('the camera does not move for emphasis (brief 6q)', () => {
  it('leaves the camera alone when the day in view, the hover or the selection changes', () => {
    const stops = [A, B, stop('x', 38.9, -9.1, { dayIndex: 1 })]
    const { ctl, map } = make(props(scene(stops, { mode: 'all', route: false, emphasisDay: 0 })))
    map.emit('idle')
    map.clearMoves()
    for (const emphasisDay of [1, 0, null]) {
      ctl.sync(props(scene(stops, { mode: 'all', route: false, emphasisDay })))
    }
    ctl.sync(
      props(scene(stops, { mode: 'all', route: false, emphasisDay: 1, selectedId: 'x' }), {
        hotId: 'a',
      }),
    )
    expect(map.moves).toBe(0)
    expect(map.setZoom).not.toHaveBeenCalled()
    // Emphasis did change the drawing.
    expect(pin('a').content).toHaveClass('is-dim')
  })

  it('dims the routes of the days not in view', () => {
    const stops = [
      A,
      B,
      stop('x', 38.9, -9.1, { dayIndex: 1 }),
      stop('y', 38.95, -9.2, { dayIndex: 1 }),
    ]
    make(props(scene(stops, { emphasisDay: 1 })))
    // A casing and a line for each of the two days.
    expect(FakePolyline.all).toHaveLength(4)
    const [, d0, , d1] = FakePolyline.all.map((l) => l.options.strokeOpacity)
    expect(d0).toBeLessThan(d1)
    expect(d1).toBe(1)
  })
})

describe('the emphasised day is off the map (brief 6q)', () => {
  const far = stop('y', 41.1, -8.6, { dayIndex: 1 })
  const day = (emphasisDay: number | null, extra: Partial<MapScene> = {}) =>
    scene([A, B, far], { mode: 'all', route: false, emphasisDay, ...extra })

  it('reports the day off the map when none of its stops is in view, and clears when it is', () => {
    const onOffMap = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const ctl = new MapController({
      google: google(),
      container,
      config: { key: 'k', mapId: 'M' },
      props: props(day(0)),
      onOffMap,
    })
    const map = FakeMap.last as FakeMap
    map.emit('idle')
    map.emit('idle')
    // The viewport is around Lisbon: day 0 is in view.
    expect(onOffMap).not.toHaveBeenCalled()
    // Scrolling to the Porto day: emphasis only, no camera move, but it is off the map.
    map.clearMoves()
    ctl.sync(props(day(1)))
    map.emit('idle')
    expect(map.moves).toBe(0)
    expect(onOffMap).toHaveBeenLastCalledWith(true)
    // Back to a day that is on the map.
    ctl.sync(props(day(0)))
    expect(onOffMap).toHaveBeenLastCalledWith(false)
  })

  it('reports a day whose stops all sit on top of each other when zoomed out', () => {
    const onOffMap = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const near1 = stop('n1', 38.7, -9.15, { dayIndex: 0 })
    const near2 = stop('n2', 38.7001, -9.1501, { dayIndex: 0 })
    new MapController({
      google: google(),
      container,
      config: { key: 'k', mapId: 'M' },
      props: props(scene([near1, near2], { mode: 'all', route: false, emphasisDay: 0 })),
      onOffMap,
    })
    const map = FakeMap.last as FakeMap
    map.view.zoom = 6
    map.emit('idle')
    map.emit('idle')
    expect(onOffMap).toHaveBeenLastCalledWith(true)
  })
})

describe('the pill is the only click', () => {
  it('reports a pill click and a hover, and handles no click on the map or its places', () => {
    const p = props(scene([A, B]), { onPinHover: vi.fn() })
    const { map } = make(p)
    pin('a').click()
    expect(p.onPinClick).toHaveBeenCalledWith('a')
    pin('a').content.dispatchEvent(new Event('pointerenter'))
    expect(p.onPinHover).toHaveBeenLastCalledWith('a')
    pin('a').content.dispatchEvent(new Event('pointerleave'))
    expect(p.onPinHover).toHaveBeenLastCalledWith(null)
    expect(map.listeners.has('click')).toBe(false)
    expect(map.options.clickableIcons).toBe(false)
  })
})

describe('geometry', () => {
  it('projects a point into the map div and back', () => {
    const b = { north: 40, south: 38, east: -8, west: -10 }
    const px = projector(b, 8)
    expect(px(40, -10)).toEqual({ x: 0, y: 0 })
    const se = px(38, -8)
    expect(se.x).toBeCloseTo(((-8 + 10) / 360) * 256 * 2 ** 8, 4)
    expect(se.y).toBeGreaterThan(0)
    expect(worldPoint(0, 0)).toEqual({ x: 128, y: 128 })
  })
  it('knows what a docked panel hides', () => {
    const b = { north: 40, south: 38, east: -8, west: -10 }
    expect(isVisible(b, { lat: 39, lng: -9 }, 800, 0)).toBe(true)
    expect(isVisible(b, { lat: 39, lng: -8.2 }, 800, 400)).toBe(false)
    expect(isVisible(b, { lat: 41, lng: -9 }, 800, 0)).toBe(false)
    expect(centreFor({ lat: 39, lng: -9 }, 10, 0)).toEqual({ lat: 39, lng: -9 })
    expect(centreFor({ lat: 39, lng: -9 }, 10, 400).lng).toBeGreaterThan(-9)
  })
})

describe('loading Google', () => {
  const key = 'AIza-test-key-not-real'
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', key)
    vi.stubEnv('VITE_GOOGLE_MAP_ID', 'MAP123')
  })

  it('reads the key and Map ID, with DEMO_MAP_ID only in dev', () => {
    expect(mapsConfig()).toEqual({ key, mapId: 'MAP123' })
    vi.stubEnv('VITE_GOOGLE_MAP_ID', '')
    expect(mapsConfig().mapId).toBe('DEMO_MAP_ID')
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    expect(mapsEnabled(mapsConfig())).toBe(false)
  })

  it('loads the maps and marker libraries once, with the key given to the loader only', async () => {
    const cfg = { key, mapId: 'MAP123' }
    await loadGoogle(cfg)
    await loadGoogle(cfg)
    expect(setOptions).toHaveBeenCalledTimes(1)
    expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({ key }))
    expect(importLibrary.mock.calls.map((c) => c[0])).toEqual(['maps', 'marker', 'core'])
  })

  it('never loads offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    await expect(loadGoogle({ key, mapId: 'MAP123' })).rejects.toThrow('offline')
    expect(importLibrary).not.toHaveBeenCalled()
    expect(setOptions).not.toHaveBeenCalled()
  })

  it('shows the plain preview and requests nothing from Google when offline', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    render(<TripMap {...props(scene([A, B]))} />)
    expect(screen.getByText('Map preview')).toBeInTheDocument()
    expect(importLibrary).not.toHaveBeenCalled()
  })

  it('loads the real map when there is a key, and falls back to the preview if Google rejects it', async () => {
    render(<TripMap {...props(scene([A, B]))} />)
    await waitFor(() => expect(FakeMap.last).not.toBeNull())
    await waitFor(() => expect(screen.queryByText('Loading map')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    // Google calls this when the key is wrong for this site.
    act(() => window.gm_authFailure?.())
    expect(await screen.findByText('Map preview')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(key)
  })

  it('shows the chip "Wed 28 is off the map · Show" for a day off the map, and Show asks the page to fit it', async () => {
    const far = stop('y', 41.1, -8.6, { dayIndex: 1 })
    const onShowDay = vi.fn()
    const s = scene([A, B, far], {
      mode: 'all',
      route: false,
      emphasisDay: 1,
      emphasisLabel: 'Wed 28',
    })
    render(<TripMap {...props(s, { onShowDay })} />)
    await waitFor(() => expect(FakeMap.last).not.toBeNull())
    await waitFor(() => expect(screen.queryByText('Loading map')).not.toBeInTheDocument())
    act(() => (FakeMap.last as FakeMap).emit('idle'))
    // The viewport is around Lisbon, so the Porto day is off the map.
    expect(await screen.findByText('Wed 28 is off the map')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(onShowDay).toHaveBeenCalledTimes(1)
  })

  it('has no chip when the emphasised day is on the map', async () => {
    const s = scene([A, B], { mode: 'all', route: false, emphasisDay: 0, emphasisLabel: 'Thu 15' })
    render(<TripMap {...props(s, { onShowDay: vi.fn() })} />)
    await waitFor(() => expect(screen.queryByText('Loading map')).not.toBeInTheDocument())
    act(() => (FakeMap.last as FakeMap).emit('idle'))
    expect(screen.queryByText(/is off the map/)).not.toBeInTheDocument()
  })

  it('has no zoom keys on the phone', async () => {
    render(<TripMap {...props(scene([A, B]), { interactive: false })} />)
    await waitFor(() => expect(FakeMap.last).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument()
  })
})

describe('without a key', () => {
  it('draws the plain Map preview with the pins on a paper ground, and loads nothing', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '')
    render(<TripMap {...props(scene([A, B, C], { nextId: 'a' }))} />)
    expect(screen.getByText('Map preview')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Map' })).toBeInTheDocument()
    expect(document.querySelectorAll('.map-pin')).toHaveLength(3)
    expect(importLibrary).not.toHaveBeenCalled()
    expect(FakeMap.made).toBe(0)
    // No OpenStreetMap credit: there is no map data on it.
    expect(document.querySelector('.map-attrib')).toBeNull()
  })

  it('needs a Map ID as well in a production build', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'k')
    vi.stubEnv('VITE_GOOGLE_MAP_ID', '')
    vi.stubEnv('DEV', false)
    render(<TripMap {...props(scene([A]))} />)
    expect(screen.getByText('Map preview')).toBeInTheDocument()
    expect(importLibrary).not.toHaveBeenCalled()
  })
})

describe('one marker per place per day', () => {
  it('shows a booking linked to a todo at the same place once, keeping the selected one', () => {
    const place = { name: 'Pena Palace', lat: 38.78, lng: -9.39, source: 'google' }
    const mk = (selectedId: string | null) =>
      buildScene({
        mode: 'day',
        day: 'd1',
        selectedId,
        schedule: {
          ideas: [],
          outside: [],
          days: [
            {
              date: 'd1',
              entries: [
                {
                  kind: 'todo',
                  todo: { todo_id: 't1', title: 'Pena', place, category: 'sight', done: false },
                },
                {
                  kind: 'booking',
                  booking: { booking_id: 'b1', title: 'Ticket', place, kind: 'ticket' },
                },
                {
                  kind: 'todo',
                  todo: {
                    todo_id: 't2',
                    title: 'Other',
                    place: { ...place, lat: 38.8 },
                    category: 'food',
                    done: false,
                  },
                },
              ],
            },
          ],
        } as never,
      })
    expect(mk(null).stops.map((s) => s.id)).toEqual(['t1', 't2'])
    expect(mk('b1').stops.map((s) => s.id)).toEqual(['b1', 't2'])
  })
})
