import type { ListIcon } from '@api/types'

export const LIST_ICONS: ListIcon[] = [
  'HOUSE',
  'CAR',
  'PLANE',
  'PENCIL',
  'APPLE',
  'BROCCOLI',
  'TV',
  'SUNFLOWER',
]

export const ICON_EMOJI: Record<ListIcon, string> = {
  HOUSE: '🏠',
  CAR: '🚗',
  PLANE: '✈️',
  PENCIL: '✏️',
  APPLE: '🍎',
  BROCCOLI: '🥦',
  TV: '📺',
  SUNFLOWER: '🌻',
}

export function toEmoji(icon?: ListIcon): string | undefined {
  if (!icon) return undefined
  return ICON_EMOJI[icon]
}

