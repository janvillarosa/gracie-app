import React, { useRef, useState, useSyncExternalStore } from 'react'
import { MapPin, X } from '@phosphor-icons/react'
import type { Place } from '@api/tripTypes'
import { placeInfoVersion, placeText, subscribePlaceInfo, type LatLng } from '@lib/trips/places'
import { MIN_QUERY, usePlaceSuggest, type Suggest } from '@lib/trips/usePlaces'
import type { Suggestion } from '@lib/trips/placesSource'
import { Button } from './Button'
import { Combobox } from './Combobox'
import { Field } from './Field'

export const suggestionKey = (s: Suggestion) => s.id
export const suggestionLabel = (s: Suggestion) =>
  s.secondary ? `${s.main}, ${s.secondary}` : s.main
export const renderSuggestion = (s: Suggestion) => (
  <>
    <span className="slip-name">{s.main}</span>
    {s.secondary && <span className="slip-usual">{s.secondary}</span>}
  </>
)

/** The attribution Google's terms require under autocomplete results shown without a Google map
 *  (and the label that says what the demo list is). */
export const PoweredBy: React.FC<{ source: Suggest['attribution']; className?: string }> = ({
  source,
  className = 'place-attrib',
}) => (
  <div className={className}>
    {source === 'google' ? 'Powered by Google' : 'Demo places (no Google key)'}
  </div>
)

export const SEARCH_UNAVAILABLE = 'Search is unavailable. Type the address instead.'

type Props = {
  // The place now set, or none. A Google place shows its name from the session cache while
  // online, else "Saved place".
  value: Place | null | undefined
  // A picked Google place (only its id, coordinates and fetch time), or null when cleared.
  onChange: (p: Place | null) => void
  label: string
  placeholder?: string
  // Bias the search to the trip's area.
  bias?: LatLng | null
  // Enter on typed text that is not a suggestion (optional: "use as an address").
  onText?: (text: string) => void
  className?: string
}

/** An inline place field: the current place as text, or a field with suggestion slips below it
 *  (Google Places autocomplete, one session per search). Picking ends the session. The slips
 *  and the attribution come from the shared Combobox. */
export const InlinePlace: React.FC<Props> = ({
  value,
  onChange,
  label,
  placeholder = 'Search for a place',
  bias,
  onText,
  className,
}) => {
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Names arrive from the session cache after the row first draws.
  useSyncExternalStore(subscribePlaceInfo, placeInfoVersion, placeInfoVersion)
  // With no place set the field is the search; with one, it searches only while being changed.
  const searching = editing || !value
  const search = usePlaceSuggest(searching ? text : '', bias)
  const fresh = search.forQuery === text.trim()
  const slips = fresh && !search.degraded ? search.suggestions.slice(0, 5) : []
  const ran = fresh && text.trim().length >= MIN_QUERY
  const shown = placeText(value)

  const pick = async (s: Suggestion) => {
    const place = await search.pick(s)
    if (place) {
      onChange(place)
      setText('')
      setEditing(false)
    }
  }

  if (value && !editing)
    return (
      <div className={`ui-inline-place ${className ?? ''}`.trim()}>
        <div className="ui-inline-place-value">
          <MapPin aria-hidden />
          <button
            type="button"
            className="ui-inline-place-text"
            aria-label={`${label}: ${shown.name || 'Saved place'}. Change`}
            onClick={() => {
              setEditing(true)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
          >
            <span className="ui-inline-place-name">{shown.name}</span>
            {shown.sub && <span className="ui-inline-place-sub">{shown.sub}</span>}
          </button>
          <Button
            kind="text"
            iconOnly
            icon={<X />}
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
          />
        </div>
      </div>
    )

  return (
    <div className={`ui-inline-place ${className ?? ''}`.trim()}>
      <Combobox
        options={slips}
        getKey={suggestionKey}
        getLabel={suggestionLabel}
        renderOption={renderSuggestion}
        onPick={pick}
        onSubmitText={() => {
          if (text.trim() && onText) {
            onText(text.trim())
            setText('')
            setEditing(false)
          }
        }}
        query={text}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && slips.length === 0) {
            setText('')
            setEditing(false)
            return true
          }
          return false
        }}
        footer={<PoweredBy source={search.attribution} className="ui-inline-place-attrib" />}
        listLabel="Places"
        placement="below"
      >
        {({ input }) => (
          <Field
            ref={inputRef as never}
            aria-label={label}
            value={text}
            placeholder={placeholder}
            autoFocus={editing}
            onChange={(e) => setText(e.target.value)}
            {...input}
          />
        )}
      </Combobox>
      <div className="place-help" role="status">
        {ran && search.degraded ? SEARCH_UNAVAILABLE : ''}
      </div>
    </div>
  )
}
