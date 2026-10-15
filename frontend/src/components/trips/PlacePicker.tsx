import React, { useId, useState } from 'react'
import { Button } from '@components/ui'
import { Input } from 'antd'
import { MapPin, X } from '@phosphor-icons/react'
import { useAuth } from '@auth/AuthProvider'
import type { Place } from '@api/tripTypes'
import {
  DEGRADED_TEXT,
  MIN_QUERY,
  OSM_ATTRIBUTION,
  PlaceSlip,
  parseCoords,
  pinFromCoords,
  usePlaceSearch,
} from './places'

type Props = {
  value: Place | null | undefined
  onChange: (p: Place | null) => void
  // Where to bias the search (rounded before it leaves the device) and the zone to fall back on.
  bias?: { lat: number; lng: number } | null
  tz?: string
  label: string
  placeholder?: string
}

export const PlacePicker: React.FC<Props> = ({
  value,
  onChange,
  bias,
  tz,
  label,
  placeholder = 'Search for a place',
}) => {
  const { apiKey } = useAuth()
  const uid = useId()
  const [text, setText] = useState('')
  const [active, setActive] = useState(-1)
  const search = usePlaceSearch(value ? '' : text, bias)
  const coords = parseCoords(text)
  const typed = text.trim()
  const fresh = search.forQuery === typed
  // Search feedback shows only once a search has run for what is typed.
  const ran = fresh && typed.length >= MIN_QUERY
  const slips = fresh ? search.results : []
  const noHits = ran && !search.loading && slips.length === 0
  const showManual = ran && !coords && (noHits || search.degraded)
  const open = slips.length > 0

  const pick = (p: Place) => {
    onChange(p)
    setText('')
    setActive(-1)
  }
  const chooseManual = () =>
    pick({
      name: typed,
      address: typed,
      lat: bias?.lat ?? 0,
      lng: bias?.lng ?? 0,
      tz,
      source: 'manual',
    })
  const dropPin = async () => {
    if (!coords) return
    pick(await pinFromCoords(apiKey as string, coords.lat, coords.lng, tz))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (open && e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, slips.length - 1))
    } else if (open && e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Escape') {
      setText('')
      setActive(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0) pick(slips[active])
      else if (coords) void dropPin()
      else if (showManual) chooseManual()
    }
  }

  if (value) {
    const hasPin = value.source !== 'manual'
    return (
      <div className="place-chosen">
        <MapPin aria-hidden />
        <span className="place-chosen-text">
          <span className="place-chosen-name">{value.name}</span>
          {(value.address || value.locality) && value.address !== value.name && (
            <span className="place-chosen-sub">{value.address || value.locality}</span>
          )}
          {!hasPin && <span className="place-chosen-sub">Address only, not on the map</span>}
        </span>
        <Button
          kind="text"
          iconOnly
          onClick={() => onChange(null)}
          icon={<X />}
          aria-label={`Remove ${label.toLowerCase()}`}
        />
      </div>
    )
  }

  return (
    <div className="place-picker">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? `${uid}-slips` : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${uid}-slip-${active}` : undefined}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          setActive(-1)
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div id={`${uid}-slips`} role="listbox" aria-label="Places" className="place-slips">
          {slips.map((p, i) => (
            <PlaceSlip
              key={`${p.osm_ref ?? p.name}-${p.lat}-${p.lng}`}
              place={p}
              id={`${uid}-slip-${i}`}
              active={i === active}
              onPick={pick}
            />
          ))}
          <div className="place-attrib">{OSM_ATTRIBUTION}</div>
        </div>
      )}
      <div className="place-help" role="status">
        {ran && search.degraded ? DEGRADED_TEXT : ''}
        {ran && !search.degraded && noHits && !coords ? 'No match. Type the address instead.' : ''}
      </div>
      {coords && (
        <Button kind="quiet" onClick={dropPin}>
          Drop a pin at {coords.lat}, {coords.lng}
        </Button>
      )}
      {showManual && (
        <Button kind="quiet" onClick={chooseManual}>
          Use “{typed}” as the address
        </Button>
      )}
    </div>
  )
}
