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

// The disc behind an emoji is a pale tint of one brand colour. Each icon takes the colour that
// stands out from its own: blue behind warm and red things, yellow behind blue things, red behind
// green ones. Display only, like the emoji (nothing is stored).
export type IconGround = 'blue' | 'yellow' | 'red'

export const ICON_GROUND: Record<ListIcon, IconGround> = {
  HOUSE: 'blue',
  CAR: 'blue',
  PLANE: 'yellow',
  PENCIL: 'blue',
  APPLE: 'blue',
  BROCCOLI: 'red',
  TV: 'yellow',
  SUNFLOWER: 'blue',
}

export function toGround(icon?: ListIcon): IconGround | undefined {
  return icon ? ICON_GROUND[icon] : undefined
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

export const TRIP_ICON_GROUND: Record<TripIcon, IconGround> = {
  SUITCASE: 'blue',
  PLANE: 'yellow',
  BEACH: 'blue',
  MOUNTAIN: 'yellow',
  CITY: 'yellow',
  TRAIN: 'yellow',
  ROAD_TRIP: 'blue',
  CAMPING: 'red',
  MAP: 'red',
  LANDMARK: 'blue',
  WINE: 'blue',
  SKI: 'yellow',
}

/** The trip icon's ground; the suitcase's when no icon is set. */
export function toTripGround(icon?: string): IconGround {
  return (icon && TRIP_ICON_GROUND[icon as TripIcon]) || TRIP_ICON_GROUND.SUITCASE
}

/** The trip's emoji; 🧳 when no icon is set (display only, nothing is stored). */
export function toTripEmoji(icon?: string): string {
  return (icon && TRIP_ICON_EMOJI[icon as TripIcon]) || TRIP_ICON_EMOJI.SUITCASE
}
