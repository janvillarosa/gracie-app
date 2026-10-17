import type React from 'react'
import type { ListIcon } from '@api/types'
import { IconDisc } from '@components/ui'
import { toEmoji, toGround, toTripEmoji, toTripGround } from '../icons'

type Shared = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  onClick?: () => void
  label?: string
}

/** A list's icon on its disc. Without an icon, nothing: callers that keep the place use `blank`. */
export const ListIconDisc: React.FC<Shared & { icon?: ListIcon }> = ({ icon, ...rest }) => (
  <IconDisc glyph={toEmoji(icon)} ground={toGround(icon)} {...rest} />
)

/** A trip's icon on its disc (the suitcase when none is set). */
export const TripIconDisc: React.FC<Shared & { icon?: string }> = ({ icon, ...rest }) => (
  <IconDisc glyph={toTripEmoji(icon)} ground={toTripGround(icon)} {...rest} />
)
