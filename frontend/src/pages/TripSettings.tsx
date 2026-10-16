import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@auth/AuthProvider'
import { HouseLoader } from '@components/HouseLoader'
import { TopNav } from '@components/TopNav'
import { WhenSheet } from '@components/trips/WhenSheet'
import { TripsPreference } from '@components/trips/TripsPreference'
import { WhereSheet } from '@components/trips/WhereSheet'
import {
  Button,
  DetailGroup,
  Note,
  NavRow,
  SectionLabel,
  Sheet,
  SheetActions,
  SheetFooter,
  SheetIdentity,
  Paper,
  PaperStack,
} from '@components/ui'
import { createPackingList } from '@api/tripEndpoints'
import type { Place } from '@api/tripTypes'
import { errorMessage } from '@lib/errors'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { useTrips } from '@lib/trips/hooks'
import { usePacking } from '@lib/trips/usePacking'
import { diffDays, routeText, shortRange } from '@lib/trips/schedule'
import { useTransitionNavigate } from '@lib/viewTransition'
import { TRIP_ICONS, TRIP_ICON_EMOJI, toTripEmoji, type TripIcon } from '../icons'
import { ChipGroup } from '@components/ui'
import '../trips.css'

/** The same place by identity (place id, else coordinates), never by name: two places can share one. */
const samePlace = (a: Place, b?: Place) =>
  !!b && (a.place_id && b.place_id ? a.place_id === b.place_id : a.lat === b.lat && a.lng === b.lng)

type SheetKind = 'icon' | 'where' | 'when' | null

/** Trip settings, as a page in the same tiers as a sheet: the trip's identity, then what is
 *  shared with the House, then what is just for you, then Delete. Everything saves as it
 *  changes, through the same outbox as the rest of the trip. */
export const TripSettings: React.FC = () => {
  const { tripId = '' } = useParams()
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  const { store, state, loading } = useTrips()
  const trip = state.trips[tripId]
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [confirming, setConfirming] = useState(false)
  const [packBusy, setPackBusy] = useState(false)
  const [packError, setPackError] = useState('')
  useDocumentTitle('Trip settings')

  const roomId = store?.roomId
  // The link counts only if the list still exists.
  const pack = usePacking(roomId, trip?.packing_list_id)

  if (loading || !store || (!trip && !state.synced)) {
    return (
      <div className="container" aria-busy="true">
        <TopNav />
        <div className="route-skeleton">
          <HouseLoader label="Loading the trip" />
        </div>
      </div>
    )
  }
  if (!trip) {
    return (
      <div className="container">
        <TopNav />
        <div className="trip-missing">
          <h1>We can’t find this trip</h1>
          <Link to="/app/trips" className="trip-link">
            See all trips
          </Link>
        </div>
      </div>
    )
  }

  const online = !state.offline && (typeof navigator === 'undefined' || navigator.onLine !== false)
  const patch = (p: Record<string, unknown>) => store.updateTrip(trip.trip_id, p)
  // "Where" is one list: the first place is the destination.
  const stops: Place[] = trip.stops?.length
    ? trip.stops
    : trip.destination
      ? [trip.destination]
      : []
  const setStops = (next: Place[]) => {
    // Changing where the trip starts also moves its zone (an explicit edit), when the place has one.
    const first = next[0]
    const moved = first && !samePlace(first, stops[0]) && first.tz
    patch({ stops: next, destination: first ?? null, ...(moved ? { tz: first.tz } : {}) })
  }
  const days = trip.start_date && trip.end_date ? diffDays(trip.end_date, trip.start_date) + 1 : 0
  const when = trip.start_date
    ? `${shortRange(trip.start_date, trip.end_date)} · ${days} ${days === 1 ? 'day' : 'days'}`
    : 'Add dates'
  const route = routeText(trip)

  const makePacking = async () => {
    setPackBusy(true)
    setPackError('')
    try {
      await createPackingList(apiKey as string, store.roomId, trip.trip_id)
      await store.flush()
      await pack.refresh()
    } catch (e) {
      setPackError(errorMessage(e, 'Couldn’t make the list. Try again.'))
    } finally {
      setPackBusy(false)
    }
  }

  return (
    <div className="container">
      <TopNav back={{ to: `/app/trips/${trip.trip_id}`, label: trip.title }} />
      <PaperStack>
        <Paper className="trip-settings">
          <SheetIdentity
            tile
            editHint
            leading={
              <button
                type="button"
                className="list-icon"
                aria-label="Change icon"
                onClick={() => setSheet('icon')}
              >
                {toTripEmoji(trip.icon)}
              </button>
            }
            title={trip.title}
            onTitle={(v) => patch({ title: v })}
            titleLabel="Trip name"
          />

          <SectionLabel>This trip</SectionLabel>
          <DetailGroup label="This trip">
            <NavRow
              label="Where"
              value={route || 'Add a place'}
              empty={!route}
              onClick={() => setSheet('where')}
            />
            <NavRow
              label="When"
              value={when}
              empty={!trip.start_date}
              onClick={() => setSheet('when')}
            />
            {pack.listId ? (
              <NavRow
                label="Packing list"
                value={pack.text || 'Open the list'}
                to={`/app/lists/${pack.listId}`}
              />
            ) : (
              <NavRow
                label="Packing list"
                value={
                  online ? (packBusy ? 'Making it…' : 'Make a packing list') : 'Connect to make one'
                }
                empty
                onClick={makePacking}
                disabled={!online || packBusy}
              />
            )}
          </DetailGroup>
          {packError && (
            <Note role="alert" tone="warn">
              {packError}
            </Note>
          )}

          <SectionLabel>Just for you</SectionLabel>
          <DetailGroup label="Just for you">
            <TripsPreference />
          </DetailGroup>

          <SheetFooter onDelete={() => setConfirming(true)} deleteLabel="Delete trip" />
        </Paper>
      </PaperStack>

      <Sheet
        open={sheet === 'icon'}
        label="Trip icon"
        onClose={() => setSheet(null)}
        identity={<SheetIdentity title="Trip icon" />}
      >
        <IconChoices
          value={(trip.icon as TripIcon | undefined) ?? 'SUITCASE'}
          onPick={(v) => {
            patch({ icon: v })
            setSheet(null)
          }}
        />
      </Sheet>
      <Sheet
        open={sheet === 'where'}
        label="Where"
        onClose={() => setSheet(null)}
        identity={<SheetIdentity title="Where" context="The first place is the destination." />}
      >
        <WhereSheet stops={stops} tz={trip.tz} onChange={setStops} />
      </Sheet>
      <WhenSheet
        open={sheet === 'when'}
        start={trip.start_date}
        end={trip.end_date}
        onChange={(s, e) => patch({ start_date: s, end_date: e })}
        onClose={() => setSheet(null)}
      />
      <Sheet
        variant="confirm"
        open={confirming}
        label={`Delete ${trip.title}?`}
        onClose={() => setConfirming(false)}
        identity={
          <SheetIdentity
            title={`Delete ${trip.title}?`}
            context="Anyone in the House can restore it for 30 days."
          />
        }
        actions={
          <SheetActions>
            <Button kind="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              kind="key"
              danger
              onClick={() => {
                store.deleteTrip(trip.trip_id)
                setConfirming(false)
                navigate(`/app/trips/${trip.trip_id}`)
              }}
            >
              Delete
            </Button>
          </SheetActions>
        }
      />
    </div>
  )
}

/** The travel icons as large choices. */
const IconChoices: React.FC<{ value: TripIcon; onPick: (v: TripIcon) => void }> = ({
  value,
  onPick,
}) => (
  <ChipGroup<TripIcon>
    label="Trip icon"
    value={value}
    options={TRIP_ICONS.map((i) => ({
      value: i,
      label: i.charAt(0) + i.slice(1).toLowerCase().replace('_', ' '),
      icon: TRIP_ICON_EMOJI[i],
    }))}
    columns={4}
    onChange={onPick}
  />
)

export default TripSettings
