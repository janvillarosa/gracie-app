import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripMap } from '@components/trips/TripMap'
import { MapController } from '@components/trips/gmap/controller'
import { centreFor, isVisible, projector, worldPoint } from '@components/trips/gmap/geometry'
import { labelText, resolveLabels } from '@components/trips/gmap/labels'
import { loadGoogle, resetGoogleLoader, type Google } from '@components/trips/gmap/loader'
import { mapsConfig, mapsEnabled } from '@components/trips/gmap/config'
import { pinState, pipColours } from '@components/trips/gmap/pin'
import type { MapViewProps } from '@components/trips/mapView'
import { buildScene, EMPTY_SCENE, type MapScene, type MapStop } from '@lib/trips/mapScene'
import {
  FakeClusterer,
  FakeGeocoder,
  FakeMap,
  FakeMarker,
  FakePlace,
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
  return { ctl, container, map: FakeMap.last as FakeMap }
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

describe('the adapter contract on the Google map (setDay / setPins / setPreview / fit / onMapClick)', () => {
  it('draws one marker per stop with our own HTML, and fits the whole trip on load', () => {
    const { map } = make(props(scene([A, B, C])))
    expect(FakeMarker.pins()).toHaveLength(3)
    expect(FakeMarker.pins().every((m) => m.gmpClickable)).toBe(true)
    expect(map.options).toMatchObject({
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: true,
    })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    const [bounds, padding] = map.fitBounds.mock.calls[0]
    expect(bounds.points).toHaveLength(3)
    expect(padding).toEqual({ top: 56, bottom: 56, left: 56, right: 56 })
  })

  it('joins the day with a thin, translucent line with arrows, and nothing for one stop', () => {
    make(props(scene([A, B, C], { colourVar: '--trip-day-2' })))
    expect(FakePolyline.all).toHaveLength(1)
    const line = FakePolyline.all[0].options
    expect(line.path).toHaveLength(3)
    expect(line.strokeWeight).toBe(3)
    expect(line.strokeOpacity).toBe(0.55)
    expect(line.icons[0].icon.path).toBe(1)
    expect(line.icons[0].repeat).toMatch(/px$/)
    make(props(scene([A])))
    expect(FakePolyline.all.filter((l) => l.live)).toHaveLength(1)
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

  it('clears everything on destroy', () => {
    const { ctl, container } = make(props(scene([A, B])))
    ctl.destroy()
    expect(FakeMarker.pins().every((m) => !m.shown)).toBe(true)
    expect(FakePolyline.all.every((l) => !l.live)).toBe(true)
    expect(container.childNodes).toHaveLength(0)
  })
})

describe('what each marker looks like', () => {
  const base = scene([A, B, C], { nextId: 'a', selectedId: 'b' })
  it('puts the category colour in the pip and a yellow ring on the next and selected stops', () => {
    make(props(base))
    expect(pin('a').content).toHaveClass('gm-pin', 'is-next')
    expect(pin('b').content).toHaveClass('is-selected')
    expect(pin('c').content).not.toHaveClass('is-next', 'is-selected')
    expect(pin('c').content.style.getPropertyValue('--gm-fill')).toBe('var(--pip-food)')
    expect(pin('c').content.style.getPropertyValue('--gm-stroke')).toBe('var(--on-pin)')
    expect(pin('c').content.querySelector('.gm-pip')).not.toBeNull()
  })

  it('says "Next · " only for the next stop and only when asked, and cuts long names', () => {
    const long = stop('l', 38.9, -9.1, { label: 'Quinta da Regaleira do Convento de Sintra' })
    const { ctl } = make(props(scene([A, long], { nextId: 'a' })))
    expect(pin('a').label).toBe('Next · a')
    const lm = () => FakeMarker.pins().find((m) => m.title.startsWith('Quinta')) as FakeMarker
    expect(lm().label).toHaveLength(22)
    expect(lm().label.endsWith('…')).toBe(true)
    ctl.sync(props(scene([A, long], { nextId: 'a' }), { nextPrefix: false, labelLimit: 14 }))
    expect(pin('a').label).toBe('a')
    expect(lm().label).toBe('Quinta da Reg…')
    expect(labelText(long, { nextId: null }, 14, false)).toHaveLength(14)
  })

  it('mutes a done stop, and draws ideas hollow with the category on the rim', () => {
    const done = stop('d', 38.9, -9.1, { done: true })
    const { ctl } = make(props(scene([A, done])))
    expect(pin('d').content).toHaveClass('is-done')
    expect(pin('d').content.style.getPropertyValue('--gm-fill')).toBe('var(--pip-done)')
    ctl.sync(props(scene([A, done], { mode: 'ideas' })))
    expect(pin('a').content).toHaveClass('is-hollow')
    expect(pin('a').content.style.getPropertyValue('--gm-fill')).toBe('var(--panel)')
    expect(pin('a').content.style.getPropertyValue('--gm-stroke')).toBe('var(--pip-food)')
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

  it('fits only the day in emphasis on an explicit fit, and the whole trip on load', () => {
    const d1 = stop('x', 38.9, -9.1, { dayIndex: 1 })
    const far = stop('y', 41.1, -8.6, { dayIndex: 2 })
    const { ctl, map } = make(
      props(scene([A, d1, far], { mode: 'all', route: false, emphasisDay: 0 })),
    )
    // On load: everything.
    expect(map.fitBounds.mock.calls[0][0].points).toHaveLength(3)
    map.clearMoves()
    ctl.sync(props(scene([A, d1, far], { mode: 'all', route: false, emphasisDay: 1 })))
    expect(map.moves).toBe(0)
    ctl.sync(
      props(scene([A, d1, far], { mode: 'all', route: false, emphasisDay: 1 }), { fitToken: 1 }),
    )
    expect(map.moves).toBe(1)
    // Day 1 has one stop: centred, not the whole trip.
    expect(map.setCenter).toHaveBeenCalled()
  })

  it('has the same states as pure functions', () => {
    const s = scene([A], { mode: 'all' })
    expect(pipColours(A, s)).toEqual({ fill: '--trip-day-0', stroke: '--on-pin' })
    const st = pinState(
      A,
      { ...s, nextId: 'a', emphasisDay: 3 },
      { hot: true, hidden: false, anchor: 'left' },
    )
    expect(st).toMatchObject({ next: true, dim: true, hot: true, labelled: false, anchor: 'left' })
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

  it('renders a cluster as a white disc with +N, and zooms in when it is clicked', () => {
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

describe('the label collision pass (after idle)', () => {
  // Four labels fit around a point (right, left, above, below); a fifth has nowhere to go.
  const stack = (n: number) =>
    Array.from({ length: n }, (_, i) => stop(`s${i}`, 38.7, -9.15, { priority: i }))

  it('keeps the higher priorities and hides the one that would overlap; every pip stays', () => {
    const { ctl, map } = make(props(scene(stack(5))))
    map.view.zoom = 10
    map.emit('idle')
    ctl.layoutLabels()
    const hidden = FakeMarker.pins().filter((m) => m.content.classList.contains('label-hidden'))
    expect(hidden.map((m) => m.title)).toEqual(['s4'])
    expect(FakeMarker.pins().every((m) => m.shown && m.content.querySelector('.gm-pip'))).toBe(true)
    // The four that stay take four different sides.
    const sides = FakeMarker.pins()
      .filter((m) => m !== hidden[0])
      .map((m) => [...m.content.classList].find((c) => c.startsWith('a-')))
    expect(new Set(sides).size).toBe(4)
  })

  it('lets a hovered stop in even when it would collide', () => {
    const { ctl, map } = make(props(scene(stack(5))))
    map.view.zoom = 10
    map.emit('idle')
    ctl.sync(props(scene(stack(5)), { hotId: 's4' }))
    ctl.layoutLabels()
    expect(pin('s4').content).not.toHaveClass('label-hidden')
    expect(pin('s4').content).toHaveClass('is-hot')
  })

  it('does not hide names of clustered stops that are not on the map', () => {
    const { ctl, map } = make(props(scene(stack(5))))
    const cl = FakeClusterer.last as FakeClusterer
    cl.stack(FakeMarker.pins().slice(0, 3))
    map.view.zoom = 10
    map.emit('idle')
    ctl.layoutLabels()
    // Only the two stops still on the map compete for space: both fit.
    expect(
      FakeMarker.pins().filter((m) => m.shown && m.content.classList.contains('label-hidden')),
    ).toHaveLength(0)
  })

  it('is a pure greedy pass: priority order, other sides tried, the loser dropped', () => {
    const size = { width: 400, height: 300 }
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      x: 200,
      y: 150,
      text: 'Some place',
      priority: i,
    }))
    expect([...resolveLabels(items, size).keys()].sort()).toEqual(['p0', 'p1', 'p2', 'p3'])
    // The order in the list does not matter, priority does.
    expect([...resolveLabels([...items].reverse(), size).keys()].sort()).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
    ])
    // A hovered stop jumps the queue.
    const hot = resolveLabels(
      items.map((i) => ({ ...i, hot: i.id === 'p4' })),
      size,
    )
    expect(hot.has('p4')).toBe(true)
    expect(hot.has('p3')).toBe(false)
    // Apart, both stay; a label never leaves the screen.
    const apart = resolveLabels(
      [items[0], { ...items[1], y: 250 }, { id: 'edge', x: 2, y: 2, text: 'Edge', priority: 9 }],
      size,
    )
    expect([...apart.keys()].sort()).toEqual(['p0', 'p1'])
  })

  it('never lets a label sit on a stop whose name is hidden', () => {
    const size = { width: 400, height: 300 }
    const items = [{ id: 'a', x: 100, y: 100, text: 'Name', priority: 1 }]
    expect(resolveLabels(items, size).get('a')).toBe('right')
    expect(resolveLabels(items, size, [{ x: 112, y: 100 }]).get('a')).not.toBe('right')
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
    expect(FakePolyline.all).toHaveLength(2)
    const [d0, d1] = FakePolyline.all.map((l) => l.options.strokeOpacity)
    expect(d0).toBeLessThan(d1)
    expect(d1).toBe(0.55)
  })
})

describe('click to add', () => {
  const click = (map: FakeMap, extra: Record<string, unknown> = {}) => {
    const stopFn = vi.fn()
    const e = { latLng: { lat: () => 38.7, lng: () => -9.2 }, stop: stopFn, ...extra }
    return { e, stopFn, run: () => act(async () => map.emit('click', e)) }
  }

  it('turns a click on a place into its place_id, with the Essentials fields only', async () => {
    const p = props(scene([A, B]), { onMapClick: vi.fn() })
    const { map } = make(p)
    const { stopFn, run } = click(map, { placeId: 'ChIJpoi' })
    await run()
    expect(stopFn).toHaveBeenCalled()
    expect(FakePlace.fetches).toEqual([
      { id: 'ChIJpoi', fields: ['id', 'displayName', 'formattedAddress', 'location'] },
    ])
    expect(p.onMapClick).toHaveBeenCalledTimes(1)
    expect(p.onMapClick).toHaveBeenCalledWith(
      expect.objectContaining({
        place_id: 'ChIJpoi',
        lat: 38.711,
        lng: -9.142,
        displayName: 'Livraria Bertrand',
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    )
    expect(FakeGeocoder.calls).toHaveLength(0)
  })

  it('reverse-geocodes an empty spot, with no place_id', async () => {
    const p = props(scene([A, B]), { onMapClick: vi.fn() })
    const { map } = make(p)
    await click(map).run()
    expect(FakeGeocoder.calls).toEqual([{ location: { lat: 38.7, lng: -9.2 } }])
    const got = (p.onMapClick as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(got).toMatchObject({ lat: 38.7, lng: -9.2, displayName: 'Rua Augusta 10, Lisboa' })
    expect(got).not.toHaveProperty('place_id')
  })

  it('still opens the card, as a dropped pin, when Google cannot answer', async () => {
    const p = props(scene([A, B]), { onMapClick: vi.fn() })
    const { map } = make(p)
    FakeGeocoder.result = 'fail'
    await click(map).run()
    FakePlace.next = 'fail'
    await click(map, { placeId: 'ChIJgone' }).run()
    const calls = (p.onMapClick as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0][0]).toMatchObject({ lat: 38.7, lng: -9.2 })
    expect(calls[0][0]).not.toHaveProperty('displayName')
    expect(calls[1][0]).toMatchObject({ place_id: 'ChIJgone', lat: 38.7 })
  })

  it('does not wait on a slow geocoder', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const p = props(scene([A, B]), { onMapClick: vi.fn() })
    const { map } = make(p)
    FakeGeocoder.result = 'hang'
    const { e } = click(map)
    map.emit('click', e)
    await vi.advanceTimersByTimeAsync(2000)
    expect(p.onMapClick).toHaveBeenCalledWith(expect.objectContaining({ lat: 38.7 }))
  })

  it('only the last of two quick clicks reports', async () => {
    const p = props(scene([A, B]), { onMapClick: vi.fn() })
    const { map } = make(p)
    const one = click(map)
    const two = click(map, { placeId: 'ChIJtwo' })
    await act(async () => {
      map.emit('click', one.e)
      map.emit('click', two.e)
    })
    expect(p.onMapClick).toHaveBeenCalledTimes(1)
    expect(p.onMapClick).toHaveBeenCalledWith(expect.objectContaining({ place_id: 'ChIJtwo' }))
  })

  it('is desktop only: the phone map is read-only', async () => {
    const p = props(scene([A, B]), { interactive: false, onMapClick: vi.fn() })
    const { map } = make(p)
    expect(map.options).toMatchObject({ clickableIcons: false, keyboardShortcuts: false })
    await click(map, { placeId: 'ChIJpoi' }).run()
    expect(p.onMapClick).not.toHaveBeenCalled()
    expect(FakePlace.fetches).toHaveLength(0)
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
