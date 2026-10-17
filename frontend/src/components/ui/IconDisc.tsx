import type React from 'react'
import type { IconGround } from '../../icons'
import './ui.css'

type Props = {
  // The emoji (or, for "no icon", a muted glyph with `blank`).
  glyph: React.ReactNode
  // Which brand colour's tint sits behind it; none is a plain Paper Tint disc.
  ground?: IconGround
  // md 44px (rows, titles), sm 36px (inside a picker tile), lg 52px (the desk's trip header).
  size?: 'sm' | 'md' | 'lg'
  blank?: boolean
  className?: string
  // With onClick the disc is a button and `label` names it; without, it is decorative.
  onClick?: () => void
  label?: string
}

/** A list's or trip's emoji on a round paper sticker, on a pale tint of one brand colour. The one way
 *  an icon is drawn: House rows, list and trip headers, trip settings, the pickers. */
export const IconDisc: React.FC<Props> = ({
  glyph,
  ground,
  size = 'md',
  blank,
  className,
  onClick,
  label,
}) => {
  const c = [
    'icon-disc',
    ground ? `is-${ground}` : '',
    size === 'md' ? '' : `is-${size}`,
    blank ? 'is-blank' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  if (onClick)
    return (
      <button type="button" className={c} aria-label={label} onClick={onClick}>
        {glyph}
      </button>
    )
  return (
    <span className={c} aria-hidden>
      {glyph}
    </span>
  )
}
