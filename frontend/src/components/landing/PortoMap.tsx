import type React from 'react'
import {
  ARTERIALS_D,
  BOATS,
  BUILDINGS_D,
  LUIS_I_D,
  LUIS_I_LOWER_D,
  MARIA_PIA_D,
  MINOR_STREETS_D,
  PARKS_D,
  PILAR,
  PORTO_VIEWBOX,
  QUAY_N_D,
  QUAY_S_D,
  RIVER_D,
  RIVER_LABEL_D,
  RIVER_MID_D,
  SHORE_N_D,
  SHORE_S_D,
} from './portoMapData'

export type MapPin = {
  id: string
  name: string
  time: string
  x: number
  y: number
  // Which side of the point the pill stands on, so neighbouring pills don't sit on each other.
  align: 'l' | 'r' | 'c'
  // The day's colour token (0 is the first day on the map, 1 the second).
  day: number
  fresh?: boolean
}

const DAY_FILL = ['var(--trip-day-0)', 'var(--trip-day-1)']

// Neighbourhood names, set small and spaced as a map sets them.
const AREAS: Array<[number, number, string]> = [
  [150, 226, 'CEDOFEITA'],
  [412, 292, 'BONFIM'],
  [346, 232, 'BOLHÃO'],
  [196, 336, 'VITÓRIA'],
  [118, 384, 'MIRAGAIA'],
  [326, 502, 'VILA NOVA DE GAIA'],
  [226, 498, 'SERRA DO PILAR'],
]

// Width of a pill from its name: close enough to Figtree at 11px that nothing needs measuring.
const pillWidth = (name: string) => Math.round(26 + name.length * 5.5)

const Pin: React.FC<{ p: MapPin }> = ({ p }) => {
  const w = pillWidth(p.name)
  const h = 22
  const left = p.align === 'l' ? p.x + 11 - w : p.align === 'r' ? p.x - 11 : p.x - w / 2
  const top = p.y - 9 - h
  const tailX = Math.min(Math.max(p.x, left + 12), left + w - 12)
  return (
    <g
      className={p.fresh ? 'ld-pin is-fresh' : 'ld-pin'}
      style={{ transformOrigin: `${p.x}px ${p.y}px` }}
    >
      <circle cx={p.x} cy={p.y} r="5.5" fill="#fff" stroke={DAY_FILL[p.day]} strokeWidth="2.5" />
      <path
        d={`M${tailX - 5} ${top + h - 0.5} L${tailX} ${top + h + 6} L${tailX + 5} ${top + h - 0.5} Z`}
        fill="#fff"
      />
      <rect x={left} y={top} width={w} height={h} rx="11" fill="#fff" className="ld-pill-shadow" />
      <circle cx={left + 12} cy={top + h / 2} r="4.5" fill={DAY_FILL[p.day]} />
      <text x={left + 22} y={top + h / 2 + 3.7} className="ld-map-name">
        {p.name}
      </text>
    </g>
  )
}

/** A day's route: a white casing under a coloured line, with white chevrons along it as the app
 *  draws it. */
const Route: React.FC<{ pins: MapPin[]; day: number; fresh?: boolean }> = ({
  pins,
  day,
  fresh,
}) => {
  const d = `M${pins.map((p) => `${p.x} ${p.y}`).join(' L')}`
  const chevrons: Array<{ x: number; y: number; a: number }> = []
  for (let i = 0; i < pins.length - 1; i++) {
    const [a, b] = [pins[i], pins[i + 1]]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.floor(len / 46))
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1)
      chevrons.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        a: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      })
    }
  }
  return (
    <g className={fresh ? 'ld-route is-fresh' : 'ld-route'}>
      <path
        d={d}
        fill="none"
        stroke="#fff"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={d}
        pathLength="1"
        fill="none"
        stroke={DAY_FILL[day]}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="ld-route-line"
      />
      {chevrons.map((c) => (
        <path
          key={`${c.x}-${c.y}`}
          d="M-2.4 -2.6 L1.2 0 L-2.4 2.6"
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`translate(${c.x} ${c.y}) rotate(${c.a})`}
        />
      ))}
    </g>
  )
}

/** Central Porto, drawn: the Douro with the Dom Luís I bridge, Ribeira and the old town on the
 *  north bank, the port-wine lodges and Serra do Pilar on the Gaia side, with the stops of the
 *  planned days as the app's pills and routes. Decorative; the list beside it says the same. */
export const PortoMap: React.FC<{ pins: MapPin[] }> = ({ pins }) => {
  const days = [0, 1].map((day) => pins.filter((p) => p.day === day))
  return (
    <svg
      className="ld-map"
      viewBox={PORTO_VIEWBOX}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <path id="ld-river-label" d={RIVER_LABEL_D} />
        <linearGradient id="ld-land" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecefe9" />
          <stop offset="1" stopColor="#e6eae3" />
        </linearGradient>
      </defs>
      <rect x="-80" y="-40" width="680" height="760" fill="url(#ld-land)" />

      {/* Streets: a pale casing under white, the way the app's styled map draws them. */}
      <path d={MINOR_STREETS_D} className="ld-map-street-casing" />
      <path d={MINOR_STREETS_D} className="ld-map-street" />
      {ARTERIALS_D.map((d) => (
        <g key={d.slice(0, 24)}>
          <path d={d} className="ld-map-art-casing" />
          <path d={d} className="ld-map-art" />
        </g>
      ))}

      {PARKS_D.map((d) => (
        <path key={d.slice(0, 20)} d={d} className="ld-map-park" />
      ))}
      <path d={BUILDINGS_D} className="ld-map-building" />
      <circle cx={PILAR.x} cy={PILAR.y} r={PILAR.r} className="ld-map-building" />
      <circle cx={PILAR.x} cy={PILAR.y} r={PILAR.r - 4} className="ld-map-pilar" />

      {/* The river, over everything it cuts through, with a bank shadow and a lighter channel. */}
      <path d={SHORE_N_D} className="ld-map-bank" />
      <path d={SHORE_S_D} className="ld-map-bank" />
      <path d={RIVER_D} className="ld-map-water" />
      <path d={RIVER_MID_D} className="ld-map-channel" />
      <path d={SHORE_N_D} className="ld-map-shore" />
      <path d={SHORE_S_D} className="ld-map-shore" />
      <path d={QUAY_N_D} className="ld-map-art-casing" />
      <path d={QUAY_N_D} className="ld-map-art" />
      <path d={QUAY_S_D} className="ld-map-art-casing" />
      <path d={QUAY_S_D} className="ld-map-art" />

      {BOATS.map(([x, y, rot]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${rot})`}>
          <ellipse rx="6.5" ry="1.9" className="ld-map-boat" />
          <path d="M-1 -1.5 L-1 -5.5 L2.4 -4.6 L2.4 -1.5 Z" className="ld-map-sail" />
        </g>
      ))}

      <path d={MARIA_PIA_D} className="ld-map-rail-casing" />
      <path d={MARIA_PIA_D} className="ld-map-rail" />
      <path d={LUIS_I_LOWER_D} className="ld-map-bridge-casing" />
      <path d={LUIS_I_LOWER_D} className="ld-map-bridge" />
      <path d={LUIS_I_D} className="ld-map-bridge-casing is-upper" />
      <path d={LUIS_I_D} className="ld-map-bridge is-upper" />

      <text className="ld-map-water-label">
        <textPath href="#ld-river-label" startOffset="8%">
          Rio Douro
        </textPath>
      </text>
      {AREAS.map(([x, y, t]) => (
        <text key={t} x={x} y={y} className="ld-map-area" textAnchor="middle">
          {t}
        </text>
      ))}
      <text x="98" y="288" className="ld-map-poi" textAnchor="middle">
        Jardins do Palácio de Cristal
      </text>
      <text x="238" y="446" className="ld-map-poi" textAnchor="end">
        Jardim do Morro
      </text>
      <text x="262" y="306" className="ld-map-poi" textAnchor="end">
        Sé do Porto
      </text>

      {days.map(
        (stops, day) =>
          stops.length > 1 && (
            <Route key={day} pins={stops} day={day} fresh={stops.some((s) => s.fresh)} />
          ),
      )}
      {pins.map((p) => (
        <Pin key={p.id} p={p} />
      ))}
    </svg>
  )
}
