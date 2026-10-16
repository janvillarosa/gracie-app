import React from 'react'
import { Navigate, useLocation, useMatch } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@auth/AuthProvider'
import { getLists, getMe, getMyRoom, isNotFound } from '@api/endpoints'
import { RoomPage, lastHousePill } from './RoomPage'
import { NoRoomPage } from './NoRoomPage'
import { Card, Alert, Button, Space } from 'antd'
import { SignIn } from '@phosphor-icons/react'
import { TopNav } from '@components/TopNav'
import { HouseLoader } from '@components/HouseLoader'

/** /app and /app/trips: one House page whose pill follows the URL. Both routes render this same
 *  component, so switching pills keeps the page mounted: only the pill's pane changes, and the
 *  sheets, avatars and data stay put instead of being rebuilt and re-animated. */
export const Dashboard: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
  const loc = useLocation()
  const tab: 'lists' | 'trips' = useMatch('/app/trips') ? 'trips' : 'lists'
  const key = apiKey!
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(key),
  })
  const roomQuery = useQuery({
    queryKey: ['my-room'],
    queryFn: () => getMyRoom(key),
    retry: false,
  })
  // Start the lists as soon as we know the house, alongside the room fetch, instead of
  // after the house page renders: one round trip less before the lists show.
  const roomId = meQuery.data?.room_id
  useQuery({
    queryKey: ['lists', roomId],
    queryFn: () => getLists(key, roomId!),
    enabled: !!roomId,
  })

  // Coming back to the House lands on the pill you last used (decided while rendering, so
  // there is no frame of the wrong pill and no effect racing the data).
  if (tab === 'lists' && loc.pathname === '/app' && lastHousePill() === 'trips')
    return <Navigate to="/app/trips" replace />

  if (meQuery.isLoading || roomQuery.isLoading) {
    return (
      <div className="container" aria-busy="true">
        <TopNav />
        <div className="route-skeleton">
          <HouseLoader label="Loading your house" />
        </div>
      </div>
    )
  }

  if (meQuery.isError) {
    return (
      <div className="container">
        <Card>
          <Alert type="error" message="Your session expired. Log in again to continue." showIcon />
          <div className="spacer" />
          <Space>
            <Button type="primary" onClick={() => setApiKey(null)} icon={<SignIn />}>
              Log in
            </Button>
          </Space>
        </Card>
      </div>
    )
  }

  if (roomQuery.isError) {
    if (isNotFound(roomQuery.error)) return <NoRoomPage />
    return (
      <div className="container">
        <Card>
          <Alert
            type="error"
            message="Couldn’t load your house. Check your connection and try again."
            showIcon
          />
          <div className="spacer" />
          <Button onClick={() => roomQuery.refetch()}>Try again</Button>
        </Card>
      </div>
    )
  }

  const room = roomQuery.data!
  const me = meQuery.data!
  return <RoomPage room={room} roomId={me.room_id!} userId={me.user_id} tab={tab} />
}
