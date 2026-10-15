import React, { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Card, Divider, Space, Typography } from 'antd'
import { ArrowLeft } from '@phosphor-icons/react'
import { useAuth } from '@auth/AuthProvider'
import { HouseLoader } from '@components/HouseLoader'
import { TopNav } from '@components/TopNav'
import { PackingPane } from '@components/trips/Panels'
import { TripDetails } from '@components/trips/TripHeader'
import { TripsPreference } from '@components/trips/TripsPreference'
import { createPackingList } from '@api/tripEndpoints'
import { errorMessage } from '@lib/errors'
import { useDocumentTitle } from '@lib/useDocumentTitle'
import { useTrips } from '@lib/trips/hooks'
import { useTransitionNavigate } from '@lib/viewTransition'
import '../trips.css'

/** Trip settings: what is shared with the House, then what is just for you. Edits go through
 *  the same outbox as everything else on a trip. */
export const TripSettings: React.FC = () => {
  const { tripId = '' } = useParams()
  const { apiKey } = useAuth()
  const navigate = useTransitionNavigate()
  const { store, state, loading } = useTrips()
  const trip = state.trips[tripId]
  const [packBusy, setPackBusy] = useState(false)
  const [packError, setPackError] = useState('')
  useDocumentTitle('Trip settings')

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
  const createPacking = async () => {
    setPackBusy(true)
    setPackError('')
    try {
      await createPackingList(apiKey as string, store.roomId, trip.trip_id)
      await store.flush()
    } catch (e) {
      setPackError(errorMessage(e, 'Couldn’t create the list. Try again.'))
    } finally {
      setPackBusy(false)
    }
  }

  return (
    <div className="container">
      <TopNav />
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography.Title level={2} style={{ margin: 0 }}>
              Trip settings
            </Typography.Title>
            <Button onClick={() => navigate(`/app/trips/${trip.trip_id}`)} icon={<ArrowLeft />}>
              Back
            </Button>
          </div>

          <div>
            <Typography.Title level={4} style={{ marginTop: 0 }}>
              This trip
            </Typography.Title>
            <Typography.Text type="secondary">Shared with the House.</Typography.Text>
            {!trip.start_date && (
              <p className="trip-help">No dates yet. Add them below when you know.</p>
            )}
            <TripDetails
              trip={trip}
              onPatch={(p) => store.updateTrip(trip.trip_id, p)}
              onDelete={() => {
                store.deleteTrip(trip.trip_id)
                navigate(`/app/trips/${trip.trip_id}`)
              }}
            />
            <Typography.Title level={5}>Packing list</Typography.Title>
            <PackingPane
              listId={trip.packing_list_id}
              online={online}
              busy={packBusy}
              error={packError}
              onCreate={createPacking}
            />
          </div>

          <Divider className="settings-divider" />

          <div>
            <Typography.Title level={4} style={{ marginTop: 0 }}>
              Just for you
            </Typography.Title>
            <TripsPreference />
          </div>
        </Space>
      </Card>
    </div>
  )
}

export default TripSettings
