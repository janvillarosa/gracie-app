import React from 'react'
import { Button } from '@components/ui'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { googleMapsUrl, mapsUrl } from '@lib/trips/schedule'

type Props = {
  lat: number
  lng: number
  placeId?: string | null
  // 'google': always Google Maps in a new tab (a Google place's own link). Default: the platform's
  // Maps (brief 6t: Apple Maps on iOS and iPadOS, Google Maps elsewhere).
  provider?: 'google' | 'platform'
  label?: string
  iconOnly?: boolean
  kind?: 'key' | 'quiet' | 'text'
  className?: string
}

/** Every "Open Maps" is one MapsLink: a new tab, never a navigation away from the trip. */
export const MapsLink: React.FC<Props> = ({
  lat,
  lng,
  placeId,
  provider = 'platform',
  label = 'Open Maps',
  iconOnly,
  kind = 'quiet',
  className,
}) => (
  <Button
    kind={kind}
    iconOnly={iconOnly}
    className={className}
    href={provider === 'google' ? googleMapsUrl(lat, lng, placeId) : mapsUrl(lat, lng, placeId)}
    target="_blank"
    rel="noreferrer noopener"
    aria-label={iconOnly ? label : undefined}
    title={iconOnly ? label : undefined}
    icon={iconOnly ? <ArrowSquareOut aria-hidden /> : undefined}
  >
    {iconOnly ? undefined : label}
  </Button>
)
