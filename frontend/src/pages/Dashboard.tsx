import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@auth/AuthProvider'
import { getMe, getMyRoom, isNotFound } from '@api/endpoints'
import { RoomPage } from './RoomPage'
import { NoRoomPage } from './NoRoomPage'

export const Dashboard: React.FC = () => {
  const { apiKey, setApiKey } = useAuth()
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

  if (meQuery.isLoading || roomQuery.isLoading) {
    return (
      <div className="container">
        <div className="panel">Loading…</div>
      </div>
    )
  }

  if (meQuery.isError) {
    return (
      <div className="container">
        <div className="panel">
          <div className="error">Session expired. Please log in again.</div>
          <div className="spacer" />
          <button className="button" onClick={() => setApiKey(null)}>Go to login</button>
        </div>
      </div>
    )
  }

  if (roomQuery.isError) {
    if (isNotFound(roomQuery.error)) return <NoRoomPage />
    return (
      <div className="container">
        <div className="panel">
          <div className="error">Failed to load your room. Please retry.</div>
        </div>
      </div>
    )
  }

  const room = roomQuery.data!
  return <RoomPage room={room} />
}
