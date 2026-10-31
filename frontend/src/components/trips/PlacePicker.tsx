import React, { useState, useSyncExternalStore } from 'react'
import {
  Button,
  Combobox,
  Field,
  PoweredBy,
  renderSuggestion,
  SEARCH_UNAVAILABLE,
  suggestionKey,
  suggestionLabel,
} from '@components/ui'
import { MapPin, X } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { hasPin, placeInfoVersion, placeText, subscribePlaceInfo } from '@lib/trips/places'
import type { Suggestion } from '@lib/trips/placesSource'
import { MIN_QUERY, parseCoords, usePlaceSuggest } from '@lib/trips/usePlaces'

type Props = {
  value: Place | null | undefined
  onChange: (p: Place | null) => void
  // Where to bias the search (rounded before it leaves the device) and the zone to fall back on.
  bias?: { lat: number; lng: number } | null
  // Where the search leans instead of `bias`: the points of the day it is for (a day can span cities).
  near?: Array<{ lat: number; lng: number }>
  tz?: string
  label: string
  placeholder?: string
}

/** One place: Google Places autocomplete (one search session per pick, "Powered by Google"
 *  under the slips), with typing an address or dropping a pin on coordinates as fallbacks. */
export const PlacePicker: React.FC<Props> = ({
  value,
  onChange,
  bias,
  near,
  tz,
  label,
  placeholder = 'Search for a place',
}) => {
  const [text, setText] = useState('')
  // Names arrive from the session cache after the row first draws.
  useSyncExternalStore(subscribePlaceInfo, placeInfoVersion, placeInfoVersion)
  const search = usePlaceSuggest(text, near?.length ? near : bias)
  const coords = parseCoords(text)
  const typed = text.trim()
  const fresh = search.forQuery === typed
  // Search feedback shows only once a search has run for what is typed.
  const ran = fresh && typed.length >= MIN_QUERY
  const slips = fresh && !search.degraded ? search.suggestions : []
  const noHits = ran && !search.loading && slips.length === 0
  const showManual = ran && !coords && (noHits || search.degraded)

  const pickPlace = (p: Place) => {
    onChange(p)
    setText('')
  }
  const pick = async (s: Suggestion) => {
    const place = await search.pick(s)
    if (place) pickPlace(place)
  }
  const chooseManual = () =>
    pickPlace({
      name: typed,
      address: typed,
      lat: bias?.lat ?? 0,
      lng: bias?.lng ?? 0,
      tz,
      source: 'manual',
    })
  const dropPin = () => {
    if (!coords) return
    pickPlace({
      name: `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
      lat: coords.lat,
      lng: coords.lng,
      tz,
      source: 'pin',
    })
  }
  const submit = () => {
    if (coords) dropPin()
    else if (showManual) chooseManual()
  }

  const shown = value ? placeText(value) : null

  return (
    <div className="place-picker">
      {/* The place now set stays in view; a search under it replaces it in one pick. */}
      {value && shown && (
        <div className="place-chosen">
          <MapPin aria-hidden />
          <span className="place-chosen-text">
            <span className="place-chosen-name">{shown.name}</span>
            {shown.sub && <span className="place-chosen-sub">{shown.sub}</span>}
            {!hasPin(value) && value.source === 'manual' && (
              <span className="place-chosen-sub">Address only, not on the map</span>
            )}
          </span>
          <Button
            kind="text"
            iconOnly
            onClick={() => onChange(null)}
            icon={<X />}
            aria-label={`Remove ${label.toLowerCase()}`}
          />
        </div>
      )}
      <Combobox
        options={slips}
        getKey={suggestionKey}
        getLabel={suggestionLabel}
        renderOption={renderSuggestion}
        onPick={pick}
        onSubmitText={submit}
        query={text}
        footer={<PoweredBy source={search.attribution} />}
        listLabel="Places"
        placement="below"
      >
        {({ input }) => (
          <Field
            aria-label={label}
            value={text}
            placeholder={value ? 'Search for another place' : placeholder}
            onChange={(e) => setText(e.target.value)}
            {...input}
          />
        )}
      </Combobox>
      <div className="place-help" role="status">
        {ran && search.degraded ? SEARCH_UNAVAILABLE : ''}
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
