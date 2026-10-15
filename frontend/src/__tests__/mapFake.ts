import { vi } from 'vitest'

// A stand-in for MapLibre: it records what the page puts on the map and lets a test act as the
// person (move, click, tap a pin) without WebGL.
type Handler = (e: Record<string, unknown>) => void
export class FakeMap {
  static last: FakeMap | null = null
  static made = 0
  handlers = new Map<string, Handler[]>()
  layerHandlers = new Map<string, Handler[]>()
  sources = new Map<
    string,
    { spec: Record<string, unknown>; data: unknown; setData: (d: unknown) => void }
  >()
  layers = new Map<string, Record<string, unknown>>()
  images = new Set<string>()
  controls: string[] = []
  rendered: Array<{
    layer: { id: string }
    properties: Record<string, unknown>
    geometry?: unknown
  }> = []
  queryHook: ((layers: string[]) => FakeMap['rendered']) | null = null
  fitBounds = vi.fn()
  easeTo = vi.fn()
  options: Record<string, unknown>
  clusterZoom = vi.fn(async () => 13)
  constructor(options: Record<string, unknown>) {
    FakeMap.last = this
    FakeMap.made++
    this.options = options
    setTimeout(() => this.emit('load', {}), 0)
  }
  touchZoomRotate = { disableRotation: () => {} }
  on(type: string, a: string | Handler, b?: Handler) {
    if (typeof a === 'string') {
      const k = `${type}:${a}`
      this.layerHandlers.set(k, [...(this.layerHandlers.get(k) ?? []), b as Handler])
    } else this.handlers.set(type, [...(this.handlers.get(type) ?? []), a])
  }
  emit(type: string, e: Record<string, unknown> = {}) {
    for (const h of this.handlers.get(type) ?? []) h(e)
  }
  addControl(c: { name: string }) {
    this.controls.push(c.name)
  }
  addImage(n: string) {
    this.images.add(n)
  }
  addSource(id: string, spec: Record<string, unknown>) {
    const src = {
      spec,
      data: spec.data,
      setData: (d: unknown) => {
        src.data = d
      },
      getClusterExpansionZoom: this.clusterZoom,
    }
    this.sources.set(id, src)
  }
  getSource(id: string) {
    return this.sources.get(id)
  }
  addLayer(l: Record<string, unknown>) {
    this.layers.set(l.id as string, l)
  }
  getLayer(id: string) {
    return this.layers.get(id)
  }
  setPaintProperty() {}
  getCanvas() {
    return { style: {} as Record<string, string> }
  }
  getBounds() {
    return { contains: () => true }
  }
  project() {
    return { x: 100, y: 100 }
  }
  queryRenderedFeatures(_p: unknown, o?: { layers?: string[] }) {
    return this.queryHook ? this.queryHook(o?.layers ?? []) : []
  }
  remove() {}
}
export class LngLatBounds {
  extend() {}
}
export class NavigationControl {
  name = 'navigation'
}
