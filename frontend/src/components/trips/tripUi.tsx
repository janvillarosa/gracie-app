import React from 'react'
import type { BookingKind, TripCategory } from '@api/tripTypes'

export const CATEGORIES: Array<{ value: TripCategory; label: string }> = [
  { value: 'food', label: 'Food' },
  { value: 'sight', label: 'Sight' },
  { value: 'activity', label: 'Activity' },
  { value: 'transport', label: 'Transport' },
  { value: 'stay', label: 'Stay' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'other', label: 'Other' },
]

export const BOOKING_KINDS: Array<{ value: BookingKind; label: string }> = [
  { value: 'flight', label: 'Flight' },
  { value: 'stay', label: 'Stay' },
  { value: 'train', label: 'Train' },
  { value: 'car', label: 'Car' },
  { value: 'ticket', label: 'Ticket' },
  { value: 'other', label: 'Other' },
]

export const categoryLabel = (c?: string) => CATEGORIES.find((x) => x.value === c)?.label ?? 'Other'

/** Day colours cycle through six (see --trip-day-* in styles.css); day 7 reuses day 1. */
export const DAY_COLOURS = 6
export const dayColourVar = (index: number) =>
  `var(--trip-day-${((index % DAY_COLOURS) + DAY_COLOURS) % DAY_COLOURS})`

export const CategoryStamp: React.FC<{ category?: string }> = React.memo(({ category }) => (
  <span className={`category-tag trip-cat trip-cat-${category || 'other'}`}>
    {categoryLabel(category)}
  </span>
))
CategoryStamp.displayName = 'CategoryStamp'

export function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/** Hours and minutes for a row: "14:00" stays as stored (wall clock in the todo's own zone). */
export const timeText = (t?: string | null) => t ?? ''

export function formatDuration(min?: number | null): string {
  if (!min) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`
}
