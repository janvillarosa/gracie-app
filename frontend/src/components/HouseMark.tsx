import React from 'react'

type Props = {
  size: number
  // Names the mark for screen readers; without it the mark is decorative.
  label?: string
  className?: string
  style?: React.CSSProperties
}

// The Bauhouse house, traced from the logo artwork onto its 168px grid (it matches
// logo-168.png to within anti-aliasing). Every part carries a class so the loader can
// draw it stroke by stroke and the logo can animate its window and door. Strokes use
// pathLength=1, so CSS can draw them with stroke-dashoffset 1 -> 0.
export const HouseMark: React.FC<Props> = ({ size, label, className, style }) => (
  <svg
    viewBox="0 0 168 168"
    width={size}
    height={size}
    className={className ? `house-mark ${className}` : 'house-mark'}
    style={style}
    focusable="false"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  >
    {label && <title>{label}</title>}
    <g fill="none" stroke="currentColor" strokeLinejoin="round" strokeLinecap="round">
      <path className="hm-roof" pathLength={1} strokeWidth={11} d="M23.5 75 L84 20.5 L144.5 74.5" />
      <path
        className="hm-shell"
        pathLength={1}
        strokeWidth={10.5}
        d="M137.5 72 V140 A7.5 7.5 0 0 1 130 147.5 H38.5 A7.5 7.5 0 0 1 31 140"
      />
      <path className="hm-lwall" pathLength={1} strokeWidth={9.5} d="M31 141 V75" />
      <path className="hm-room" pathLength={1} strokeWidth={10} d="M23.5 75 H101 V147" />
      <rect
        className="hm-frame"
        pathLength={1}
        strokeWidth={10}
        strokeLinejoin="miter"
        x="53"
        y="93"
        width="22"
        height="24"
      />
      <path
        className="hm-lintel"
        pathLength={1}
        strokeWidth={10}
        d="M101 98 H137.5 M128.5 98 V146"
      />
    </g>
    {/* Dark doorway behind the door, seen only while the door swings open */}
    <rect className="hm-doorway" x="106" y="103" width="18" height="40" fill="currentColor" />
    <rect className="hm-pane" x="58" y="98" width="12" height="14" fill="var(--brand-yellow)" />
    <rect className="hm-door" x="106" y="103" width="18" height="40" fill="var(--brand-red)" />
  </svg>
)
