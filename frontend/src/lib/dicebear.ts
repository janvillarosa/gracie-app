function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

function deriveBgHex(seed: string): string {
  const h = hashSeed(seed)
  const hue = h % 360
  // Pleasant pastel background
  return hslToHex(hue, 55, 78)
}

export function dicebearUrl(style: string, seed: string, size = 64, withBackground = true) {
  const s = encodeURIComponent(style || 'adventurer-neutral')
  const q = new URLSearchParams({ seed, size: String(size), radius: '50' })
  if (withBackground) {
    q.set('backgroundType', 'solid')
    q.set('backgroundColor', deriveBgHex(seed))
  }
  // Miniavs supports an explicit hair list. Exclude 'balndess' by whitelisting others.
  if ((style || 'adventurer-neutral').toLowerCase() === 'miniavs') {
    const allowed = [
      'classic01', 'classic02', 'curly', 'elvis', 'long', 'ponyTail', 'slaughter', 'stylish',
    ]
    q.set('hair', allowed.join(','))
  }
  return `https://api.dicebear.com/9.x/${s}/svg?${q.toString()}`
}
