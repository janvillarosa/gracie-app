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

// Trips have their own icon set: the key is stored, the emoji is display only.
export const TRIP_ICONS = [
  'SUITCASE',
  'PLANE',
  'BEACH',
  'MOUNTAIN',
  'CITY',
  'TRAIN',
  'ROAD_TRIP',
  'CAMPING',
  'MAP',
  'LANDMARK',
  'WINE',
  'SKI',
] as const

export type TripIcon = (typeof TRIP_ICONS)[number]

export const TRIP_ICON_EMOJI: Record<TripIcon, string> = {
  SUITCASE: '🧳',
  PLANE: '✈️',
  BEACH: '🏖️',
  MOUNTAIN: '🏔️',
  CITY: '🏙️',
  TRAIN: '🚆',
  ROAD_TRIP: '🚗',
  CAMPING: '⛺',
  MAP: '🗺️',
  LANDMARK: '🏛️',
  WINE: '🍷',
  SKI: '🎿',
}

/** The trip's emoji; 🧳 when no icon is set (display only, nothing is stored). */
export function toTripEmoji(icon?: string): string {
  return (icon && TRIP_ICON_EMOJI[icon as TripIcon]) || TRIP_ICON_EMOJI.SUITCASE
}
